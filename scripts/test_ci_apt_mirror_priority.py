"""Pure synthetic admission/custody controls; never invoke APT or require root."""
import os
import itertools
import stat
from pathlib import Path
import tempfile
import unittest
from ci_apt_mirror_priority import (STOCK, URIS, BOUNDS, SECURITY, admit_platform, admit_apt_version,
    mirror_candidate, admit_sources, parse_config, admit_config, safe_read, replace_original,
    component_diagnostics, config_diagnostics, security_representations, PREFLIGHT_DIRECTORIES, fixed_directory_diagnostics,
    KEYRING_PERMISSION_CHAIN, harden_original_keyring_permissions)

SOURCE = '''Types: deb
URIs: mirror+file:/etc/apt/apt-mirrors.txt
Suites: noble noble-updates noble-backports
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

Types: deb
URIs: mirror+file:/etc/apt/apt-mirrors.txt
Suites: noble-security
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
'''.encode()


from contextlib import contextmanager


@contextmanager
def keyring_fixture(safe=False):
    # All actual filesystem effects are confined to the owned synthetic temporary tree.
    from unittest.mock import patch
    from types import SimpleNamespace
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory).resolve()
        usr = root / 'usr'; share = usr / 'share'; keyrings = share / 'keyrings'
        keyrings.mkdir(parents=True)
        output = root / 'owned-output'; output.mkdir(mode=0o700)
        keys = [keyrings / 'ubuntu-archive-keyring.gpg', keyrings / 'other-public.asc']
        for index, key in enumerate(keys):
            key.write_bytes(f'synthetic-public-key-{index}'.encode())
            key.chmod(0o644 if safe else 0o777)
        share.chmod(0o755 if safe else 0o777); keyrings.chmod(0o755 if safe else 0o777)
        overrides = {}
        original_fstat, original_lstat, original_stat, original_open, original_fchmod = os.fstat, os.lstat, os.stat, os.open, os.fchmod
        def admitted_stat(info):
            values = {name: getattr(info, name) for name in dir(info) if name.startswith('st_')}
            values.update(st_uid=0, st_gid=0)
            values.update(overrides.get(info.st_ino, {}))
            return SimpleNamespace(**values)
        held = []
        def opened(*args, **kwargs):
            fd = original_open(*args, **kwargs)
            if args[1] & os.O_DIRECTORY or kwargs.get('dir_fd') is not None:
                held.append(fd)
            return fd
        with patch('ci_apt_mirror_priority.KEYRING_PERMISSION_CHAIN',
                   tuple(map(str, (root, usr, share, keyrings)))),                 patch('ci_apt_mirror_priority.os.fstat', side_effect=lambda fd: admitted_stat(original_fstat(fd))),                 patch('ci_apt_mirror_priority.os.lstat', side_effect=lambda *a, **kw: admitted_stat(original_lstat(*a, **kw))),                 patch('ci_apt_mirror_priority.os.stat', side_effect=lambda *a, **kw: admitted_stat(original_stat(*a, **kw))),                 patch('ci_apt_mirror_priority.os.open', side_effect=opened),                 patch('ci_apt_mirror_priority.os.fchmod', wraps=os.fchmod) as fchmod:
            yield SimpleNamespace(root=root, share=share, keyrings=keyrings, output=output,
                                  keys=keys, overrides=overrides, fchmod=fchmod, held=held, original_fchmod=original_fchmod)


class AdmissionTests(unittest.TestCase):
    def test_numeric_false_defaults_are_admitted_without_changing_raw_config(self):
        raw = (b'Acquire::AllowInsecureRepositories "0";\n'
               b'Acquire::AllowWeakRepositories "0";\n'
               b'Acquire::AllowDowngradeToInsecureRepositories "0";\n')
        values = parse_config(raw)
        for after in (False, True):
            admit_config({**BOUNDS, **values}, after=after)
        self.assertEqual(set(values.values()), {'0'})
        self.assertEqual(security_representations(values), dict.fromkeys(values, '0'))
        self.assertEqual(set(config_diagnostics(values).values()), {False})

    def test_same_boolean_polarity_is_admitted_for_every_root_and_binary_security_leaf(self):
        for key, expected in SECURITY.items():
            numeric = '1' if expected == 'true' else '0'
            for spelling in (expected, numeric):
                for prefix in ('', 'Binary::apt-get::'):
                    for after in (False, True):
                        with self.subTest(key=key, spelling=spelling, prefix=prefix, after=after):
                            admit_config({**BOUNDS, prefix + key: spelling}, after=after)
        admit_config(dict(BOUNDS), after=True)

    def test_opposite_and_unknown_security_spellings_remain_refused_at_both_scopes(self):
        for key, expected in SECURITY.items():
            opposite = ('false', '0') if expected == 'true' else ('true', '1')
            for spelling in opposite + ('', '00', '01', 'TRUE', 'FALSE', 'yes', 'no', '1junk', 'private_fixture_text'):
                for prefix in ('', 'Binary::apt-get::'):
                    for after in (False, True):
                        with self.subTest(key=key, spelling=spelling, prefix=prefix, after=after), self.assertRaises(RuntimeError):
                            admit_config({**BOUNDS, prefix + key: spelling}, after=after)

    def test_safe_numeric_root_never_masks_an_unsafe_binary_override(self):
        for key, expected in SECURITY.items():
            numeric = '1' if expected == 'true' else '0'
            opposite = '0' if expected == 'true' else '1'
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, 'apt-get authentication override'):
                admit_config({**BOUNDS, key: numeric, 'Binary::apt-get::' + key: opposite})

    def test_raw_security_diagnostics_have_closed_keys_and_spellings(self):
        values = {'Acquire::AllowInsecureRepositories': '0', 'Acquire::AllowWeakRepositories': 'false',
                  'Acquire::https::Verify-Peer': '1', 'Acquire::https::Verify-Host': 'true',
                  'Binary::apt-get::Acquire::Check-Date': 'private_fixture_text',
                  'Acquire::http::Proxy': 'private_fixture_text', 'Acquire::Retries': '1'}
        self.assertEqual(security_representations(values),
                         {'Acquire::AllowInsecureRepositories': '0', 'Acquire::AllowWeakRepositories': 'false',
                          'Acquire::https::Verify-Peer': '1', 'Acquire::https::Verify-Host': 'true',
                          'Binary::apt-get::Acquire::Check-Date': 'unsupported'})
        self.assertNotIn('private_fixture_text', repr(security_representations(values)))

    def test_fifo_member_refuses_before_open_or_permission_write(self):
        from unittest.mock import patch
        with keyring_fixture() as fixture:
            fifo = fixture.keyrings / 'fifo.gpg'; os.mkfifo(fifo)
            with patch('ci_apt_mirror_priority.os.open', wraps=os.open) as opened,                     self.assertRaisesRegex(RuntimeError, 'Root-owned admitted original public key required'):
                harden_original_keyring_permissions(fixture.output)
            self.assertFalse(any(call.args[0] == 'fifo.gpg' for call in opened.call_args_list))
            fixture.fchmod.assert_not_called()

    def test_member_open_is_nonblocking_and_named_prestat_drift_is_refused(self):
        from unittest.mock import patch
        with keyring_fixture() as fixture:
            original = os.open
            observed = []
            def replaced(name, flags, **kwargs):
                if name == 'other-public.asc':
                    observed.append(flags)
                    path = fixture.keyrings / name
                    path.unlink(); os.mkfifo(path)
                return original(name, flags, **kwargs)
            with patch('ci_apt_mirror_priority.os.open', side_effect=replaced), self.assertRaises(RuntimeError):
                harden_original_keyring_permissions(fixture.output)
            self.assertTrue(observed and all(flags & os.O_NONBLOCK and flags & os.O_NOFOLLOW for flags in observed))
            fixture.fchmod.assert_not_called()

    def test_post_close_reopened_original_key_replacement_is_refused(self):
        from unittest.mock import patch
        with keyring_fixture() as fixture:
            original_close = os.close
            changed = []
            def closed(fd):
                original_close(fd)
                if fixture.held and fd == fixture.held[0] and not changed:
                    changed.append(True)
                    replacement = fixture.root / 'closed-replacement'
                    replacement.write_bytes(fixture.keys[0].read_bytes()); replacement.chmod(0o644)
                    os.replace(replacement, fixture.keys[0])
            with patch('ci_apt_mirror_priority.os.close', side_effect=closed), self.assertRaises(RuntimeError):
                harden_original_keyring_permissions(fixture.output)
            self.assertTrue(changed)
            self.assertFalse((fixture.output / 'keyring-permissions.result.json').exists())

    def test_post_close_reopened_key_bytes_and_members_are_compared(self):
        from unittest.mock import patch
        for fault in ('bytes', 'member'):
            with self.subTest(fault=fault), keyring_fixture() as fixture:
                original_close = os.close
                changed = []
                def closed(fd):
                    original_close(fd)
                    if fixture.held and fd == fixture.held[0] and not changed:
                        changed.append(True)
                        if fault == 'bytes': fixture.keys[0].write_bytes(b'x' * len(fixture.keys[0].read_bytes()))
                        else: (fixture.keyrings / 'added.gpg').write_bytes(b'added-public-fixture')
                with patch('ci_apt_mirror_priority.os.close', side_effect=closed), self.assertRaises(RuntimeError):
                    harden_original_keyring_permissions(fixture.output)
                self.assertTrue(changed)
                self.assertFalse((fixture.output / 'keyring-permissions.result.json').exists())

    def test_hardening_scope_is_closed_root_usr_share_keyrings_chain(self):
        self.assertEqual(KEYRING_PERMISSION_CHAIN, ('/', '/usr', '/usr/share', '/usr/share/keyrings'))

    def test_original_fd_permission_hardening_preserves_bytes_and_custody(self):
        import json
        with keyring_fixture() as fixture:
            originals = {path: (path.read_bytes(), path.stat().st_ino) for path in fixture.keys}
            result = harden_original_keyring_permissions(fixture.output)
            self.assertEqual(result['changedOriginalModes'], 4)
            self.assertEqual(result['existingPublicKeyFiles'], 2)
            self.assertEqual(result['originalContentAuthenticity'], 'NOT_ESTABLISHED_BY_PERMISSION_REPAIR')
            self.assertEqual([call.args[1] for call in fixture.fchmod.call_args_list], [0o755, 0o755, 0o644, 0o644])
            for path, original in originals.items():
                self.assertEqual((path.read_bytes(), path.stat().st_ino), original)
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o644)
                self.assertEqual(safe_read(path)[0], original[0])
            self.assertEqual(stat.S_IMODE(fixture.share.stat().st_mode), 0o755)
            self.assertEqual(stat.S_IMODE(fixture.keyrings.stat().st_mode), 0o755)
            plan = json.loads((fixture.output / 'keyring-permissions.original.json').read_bytes())
            self.assertEqual(len(plan), 6)
            self.assertEqual(len(list(fixture.output.glob('public-key-*.original'))), 2)
            self.assertTrue((fixture.output / 'keyring-permissions.result.json').exists())
            for fd in fixture.held:
                with self.assertRaises(OSError): os.fstat(fd)

    def test_already_safe_keyring_modes_do_not_change(self):
        with keyring_fixture(safe=True) as fixture:
            result = harden_original_keyring_permissions(fixture.output)
            self.assertEqual(result['changedOriginalModes'], 0)
            fixture.fchmod.assert_not_called()

    def test_every_unadmitted_member_refuses_before_first_permission_write(self):
        for fault in ('owner', 'mode', 'symlink', 'hardlink', 'name'):
            with self.subTest(fault=fault), keyring_fixture() as fixture:
                key = fixture.keys[-1]
                if fault == 'owner': fixture.overrides[key.stat().st_ino] = {'st_uid': 1001}
                elif fault == 'mode': key.chmod(0o775)
                elif fault == 'symlink': key.unlink(); key.symlink_to(fixture.keys[0])
                elif fault == 'hardlink': os.link(key, fixture.keyrings / 'linked.gpg')
                else: (fixture.keyrings / 'unsupported.txt').write_bytes(b'public-fixture')
                with self.assertRaises((RuntimeError, OSError)):
                    harden_original_keyring_permissions(fixture.output)
                fixture.fchmod.assert_not_called()
                self.assertFalse((fixture.output / 'keyring-permissions.original.json').exists())

    def test_nonroot_or_writable_root_ancestor_cannot_be_repaired(self):
        for fault in ('owner', 'writable'):
            with self.subTest(fault=fault), keyring_fixture() as fixture:
                if fault == 'owner': fixture.overrides[fixture.root.stat().st_ino] = {'st_uid': 1001}
                else: fixture.root.chmod(0o777)
                with self.assertRaisesRegex(RuntimeError, 'Root-owned admitted keyring directory required'):
                    harden_original_keyring_permissions(fixture.output)
                fixture.fchmod.assert_not_called()

    def test_public_key_byte_drift_after_private_custody_refuses_before_write(self):
        from unittest.mock import patch
        from ci_apt_mirror_priority import write_owned
        with keyring_fixture() as fixture:
            def custody(path, raw):
                write_owned(path, raw)
                if path.name == 'keyring-permissions.original.json': fixture.keys[0].write_bytes(b'changed')
            with patch('ci_apt_mirror_priority.write_owned', side_effect=custody),                     self.assertRaisesRegex(RuntimeError, 'drift after custody before hardening'):
                harden_original_keyring_permissions(fixture.output)
            fixture.fchmod.assert_not_called()
            self.assertTrue((fixture.output / 'keyring-permissions.original.json').exists())

    def test_original_named_fd_replacement_after_custody_refuses_before_write(self):
        from unittest.mock import patch
        from ci_apt_mirror_priority import write_owned
        with keyring_fixture() as fixture:
            def custody(path, raw):
                write_owned(path, raw)
                if path.name == 'keyring-permissions.original.json':
                    replacement = fixture.root / 'replacement'
                    replacement.write_bytes(fixture.keys[0].read_bytes()); replacement.chmod(0o777)
                    os.replace(replacement, fixture.keys[0])
            with patch('ci_apt_mirror_priority.write_owned', side_effect=custody), self.assertRaises(RuntimeError):
                harden_original_keyring_permissions(fixture.output)
            fixture.fchmod.assert_not_called()

    def test_partial_permission_failure_never_reopens_hardened_parent(self):
        with keyring_fixture() as fixture:
            original = fixture.original_fchmod
            calls = []
            def fail_second(fd, mode):
                calls.append((fd, mode))
                if len(calls) == 2: raise PermissionError('synthetic second change failure')
                original(fd, mode)
            fixture.fchmod.side_effect = fail_second
            with self.assertRaises(PermissionError): harden_original_keyring_permissions(fixture.output)
            self.assertEqual(len(calls), 2)
            self.assertEqual(stat.S_IMODE(fixture.share.stat().st_mode), 0o755)
            self.assertEqual(stat.S_IMODE(fixture.keyrings.stat().st_mode), 0o777)
            self.assertTrue((fixture.output / 'keyring-permissions.original.json').exists())
            self.assertFalse((fixture.output / 'keyring-permissions.result.json').exists())

    def test_unsupported_directory_mode_and_symlink_refuse_before_write(self):
        for fault in ('mode', 'symlink'):
            with self.subTest(fault=fault), keyring_fixture() as fixture:
                if fault == 'mode': fixture.share.chmod(0o775)
                else:
                    fixture.keyrings.rename(fixture.share / 'moved-original')
                    fixture.keyrings.symlink_to(fixture.share / 'moved-original')
                with self.assertRaises((RuntimeError, OSError)):
                    harden_original_keyring_permissions(fixture.output)
                fixture.fchmod.assert_not_called()

    def test_failed_first_fchmod_preserves_originals_and_closes_fds_without_retry(self):
        with keyring_fixture() as fixture:
            fixture.fchmod.side_effect = PermissionError('synthetic permission failure')
            with self.assertRaises(PermissionError): harden_original_keyring_permissions(fixture.output)
            self.assertEqual(fixture.fchmod.call_count, 1)
            self.assertTrue((fixture.output / 'keyring-permissions.original.json').exists())
            self.assertFalse((fixture.output / 'keyring-permissions.result.json').exists())
            self.assertEqual(stat.S_IMODE(fixture.share.stat().st_mode), 0o777)
            for fd in fixture.held:
                with self.assertRaises(OSError): os.fstat(fd)


    def test_directory_diagnostics_complete_after_resolution_loop(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        info = SimpleNamespace(st_uid=0, st_gid=0, st_mode=stat.S_IFDIR | 0o755,
                               st_dev=1, st_ino=2, st_nlink=2, st_size=4096)
        def resolve(path, **kw):
            if str(path) == PREFLIGHT_DIRECTORIES[0]:
                raise RuntimeError('private_fixture_text')
            return path
        with patch('ci_apt_mirror_priority.os.lstat', return_value=info), \
                patch.object(Path, 'resolve', resolve):
            rows = fixed_directory_diagnostics()
        self.assertEqual([row['path'] for row in rows], list(PREFLIGHT_DIRECTORIES))
        self.assertFalse(rows[0]['canonical'])
        self.assertTrue(all(row['canonical'] for row in rows[1:]))
        self.assertTrue(all(row['identityStable'] for row in rows))
        self.assertNotIn('private_fixture_text', repr(rows))

    def test_fixed_directory_diagnostics_emit_all_five_closed_paths(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        info = SimpleNamespace(st_uid=0, st_gid=0, st_mode=stat.S_IFDIR | 0o755,
                               st_dev=1, st_ino=2, st_nlink=2, st_size=4096)
        self.assertEqual(PREFLIGHT_DIRECTORIES, ('/etc/apt/sources.list.d', '/etc/apt/trusted.gpg.d',
                         '/etc/apt/keyrings', '/usr/share/keyrings', '/etc/apt/apt.conf.d'))
        with patch('ci_apt_mirror_priority.os.lstat', return_value=info), \
                patch.object(Path, 'resolve', lambda path, **kw: path), \
                patch.object(Path, 'iterdir', side_effect=AssertionError('must not list members')), \
                patch('ci_apt_mirror_priority.os.chmod') as chmod, \
                patch('ci_apt_mirror_priority.os.chown') as chown:
            rows = fixed_directory_diagnostics()
        self.assertEqual([row['path'] for row in rows], list(PREFLIGHT_DIRECTORIES))
        self.assertTrue(all(row['uid'] == 0 and row['mode'] == '0o755' and row['canonical']
                            and row['identityStable'] and row['type'] == 'directory' for row in rows))
        self.assertTrue(all(set(row) == {'path', 'observation', 'type', 'uid', 'gid', 'mode',
                                        'canonical', 'identityStable'} for row in rows))
        chmod.assert_not_called(); chown.assert_not_called()

    def test_directory_diagnostics_complete_after_unsafe_missing_and_symlink(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        def info(mode, uid=0):
            return SimpleNamespace(st_uid=uid, st_gid=0, st_mode=mode,
                                   st_dev=1, st_ino=2, st_nlink=2, st_size=4096)
        values = {PREFLIGHT_DIRECTORIES[0]: info(stat.S_IFDIR | 0o755),
                  PREFLIGHT_DIRECTORIES[1]: info(stat.S_IFDIR | 0o777, 1001),
                  PREFLIGHT_DIRECTORIES[2]: FileNotFoundError('private_fixture_text'),
                  PREFLIGHT_DIRECTORIES[3]: info(stat.S_IFLNK | 0o777),
                  PREFLIGHT_DIRECTORIES[4]: PermissionError('private_fixture_text')}
        def observe(path):
            value = values[str(path)]
            if isinstance(value, OSError):
                raise value
            return value
        def resolve(path, **kw):
            return Path('/private_fixture_text') if str(path) == PREFLIGHT_DIRECTORIES[3] else path
        with patch('ci_apt_mirror_priority.os.lstat', side_effect=observe), \
                patch.object(Path, 'resolve', resolve):
            rows = fixed_directory_diagnostics()
        self.assertEqual(len(rows), 5)
        self.assertEqual((rows[1]['uid'], rows[1]['mode']), (1001, '0o777'))
        self.assertEqual(rows[2]['observation'], 'missing')
        self.assertEqual(rows[3]['type'], 'symlink'); self.assertFalse(rows[3]['canonical'])
        self.assertEqual(rows[4]['observation'], 'unavailable')
        self.assertNotIn('private_fixture_text', repr(rows))

    def test_directory_diagnostics_observe_identity_drift_and_bound_ids(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        calls = {}
        def observe(path):
            calls[path] = calls.get(path, 0) + 1
            return SimpleNamespace(st_uid=4294967296, st_gid=-1, st_mode=stat.S_IFDIR | 0o755,
                                   st_dev=1, st_ino=calls[path], st_nlink=2, st_size=4096)
        with patch('ci_apt_mirror_priority.os.lstat', side_effect=observe), \
                patch.object(Path, 'resolve', lambda path, **kw: path):
            rows = fixed_directory_diagnostics()
        self.assertTrue(all(row['uid'] is None and row['gid'] is None and not row['identityStable']
                            for row in rows))
        self.assertEqual(set(calls), set(PREFLIGHT_DIRECTORIES))

    def test_unsafe_source_trust_permissions_remain_refused(self):
        from unittest.mock import patch, Mock
        from ci_apt_mirror_priority import input_namespace
        for uid, mode in ((1001, 0o40755), (0, 0o40777), (0, 0o40775)):
            with self.subTest(uid=uid, mode=mode), \
                    patch.object(Path, 'exists', return_value=True), \
                    patch.object(Path, 'resolve', lambda path, **kw: path), \
                    patch.object(Path, 'stat', return_value=Mock(st_uid=uid, st_mode=mode)), \
                    self.assertRaisesRegex(RuntimeError, 'Root-owned source/trust directory required'):
                input_namespace()

    def test_only_three_priority_tokens_change(self):
        expected = ''.join(f'{uri}\tpriority:{n}\n' for uri, n in zip(URIS, (3, 1, 2))).encode()
        self.assertEqual(mirror_candidate(STOCK), expected)
        self.assertEqual([line.split(b'\t')[0] for line in expected.splitlines()],
                         [line.split(b'\t')[0] for line in STOCK.splitlines()])

    def test_uri_priority_partial_and_duplicate_inputs_refused(self):
        for raw in (STOCK.replace(b'https:', b'http:'), STOCK.replace(b'priority:2', b'priority:1'),
                    STOCK[:-1], STOCK + STOCK.splitlines(keepends=True)[0],
                    STOCK.replace(b'archive.ubuntu.com/', b'user:secret@archive.ubuntu.com/')):
            with self.subTest(raw=raw), self.assertRaises(RuntimeError):
                mirror_candidate(raw)

    def test_stock_source_and_signed_key_admitted(self):
        admit_sources(SOURCE)

    def test_route_trust_extra_suite_and_duplicate_refused(self):
        for raw in (SOURCE.replace(b'mirror+file:', b'https:'), SOURCE + b'\nTrusted: yes\n',
                    SOURCE.replace(b'noble-security', b'jammy-security'),
                    SOURCE.replace(b'ubuntu-archive-keyring.gpg', b'other.gpg'),
                    SOURCE.replace(b'Suites: noble-security', b'Suites: noble noble-security')):
            with self.subTest(raw=raw), self.assertRaises(RuntimeError):
                admit_sources(raw)

    def test_all_24_component_permutations_are_admitted(self):
        original = b'main restricted universe multiverse'
        for permutation in itertools.permutations(original.split()):
            actual = SOURCE.replace(original, b' '.join(permutation))
            observations = []
            with self.subTest(permutation=permutation):
                admit_sources(actual, observations.append)
                self.assertEqual([row['componentOrder'] for row in observations],
                                 [[word.decode() for word in permutation]] * 2)

    def test_missing_duplicate_extra_components_are_refused(self):
        for value in (b'main restricted universe', b'main main universe multiverse',
                      b'main restricted universe multiverse extra', b''):
            observations = []
            with self.subTest(value=value), self.assertRaisesRegex(RuntimeError, 'Stock Ubuntu components required'):
                admit_sources(SOURCE.replace(b'main restricted universe multiverse', value), observations.append)
            self.assertEqual(observations[0]['componentCount'], len(value.split()))

    def test_component_diagnostics_are_masked_and_bounded(self):
        values = ['main', 'private_fixture_text'] + ['universe'] * 20
        observed = component_diagnostics(values)
        self.assertEqual(observed['componentOrder'][:2], ['main', 'unsupported'])
        self.assertEqual(len(observed['componentOrder']), 16)
        self.assertEqual(observed['componentCount'], 22)
        self.assertTrue(observed['truncated'])
        self.assertNotIn('private_fixture_text', repr(observed))

    def test_config_diagnostics_are_typed_whitelisted_and_masked(self):
        values = {'Acquire::Retries': '1', 'Acquire::http::Timeout': '15',
                  'Acquire::https::Timeout': 'private_fixture_text', 'APT::Update::Error-Mode': 'any',
                  'Acquire::https::Verify-Peer': 'true', 'APT::Get::AllowUnauthenticated': 'false',
                  'Binary::apt-get::Acquire::Retries': '9999999', 'Acquire::http::Proxy': 'private_fixture_text'}
        self.assertEqual(config_diagnostics(values), {'Acquire::Retries': 1, 'Acquire::http::Timeout': 15,
                         'Acquire::https::Timeout': 'unsupported', 'APT::Update::Error-Mode': 'any',
                         'Acquire::https::Verify-Peer': True, 'APT::Get::AllowUnauthenticated': False,
                         'Binary::apt-get::Acquire::Retries': 'unsupported'})
        self.assertNotIn('private_fixture_text', repr(config_diagnostics(values)))

    def test_observed_version_text_is_bounded(self):
        with self.assertRaises(RuntimeError):
            admit_apt_version(b'apt 2.8.3' + b'a' * 65 + b' (amd64)\n')

    def test_platform_requires_actual_hosted_ubuntu_root(self):
        args = ['Linux', 'x86_64', 0, {'ID': 'ubuntu', 'VERSION_ID': '24.04'}, 'ubuntu24', '20261004.327.1', 'true', 'github-hosted']
        admit_platform(*args)
        for index, bad in ((0, 'Darwin'), (1, 'arm64'), (2, 501), (3, {'ID': 'ubuntu', 'VERSION_ID': '22.04'}),
                           (4, 'ubuntu22'), (5, ''), (6, 'false'), (7, 'self-hosted')):
            changed = args.copy(); changed[index] = bad
            with self.subTest(index=index), self.assertRaises(RuntimeError):
                admit_platform(*changed)

    def test_supported_actual_apt_version(self):
        self.assertEqual(admit_apt_version(b'apt 2.8.3 (amd64)\nSupported modules:\n'), '2.8.3')
        self.assertEqual(admit_apt_version(b'apt 2.8.4 (amd64)\n'), '2.8.4')
        for raw in (b'apt 2.7.9 (amd64)\n', b'apt 2.9.0 (amd64)\n', b'apt 2.8.3 (arm64)\n', b'unknown\n', b'', b'\xff'):
            with self.subTest(raw=raw), self.assertRaises(RuntimeError): admit_apt_version(raw)

    def test_public_keyring_namespace_is_included(self):
        # Inspect the pure namespace selector source without touching Mac system trust files.
        from unittest.mock import patch, Mock
        from ci_apt_mirror_priority import input_namespace
        roots = ('/etc/apt/sources.list.d', '/etc/apt/trusted.gpg.d', '/etc/apt/keyrings', '/usr/share/keyrings')
        files = {Path(root): [Path(root) / 'public.gpg'] for root in roots}
        with patch.object(Path, 'exists', return_value=True), patch.object(Path, 'resolve', lambda path, **kw: path), \
                patch.object(Path, 'stat', return_value=Mock(st_uid=0, st_mode=0o40755)), \
                patch.object(Path, 'iterdir', lambda path: iter(files[path])):
            selected = input_namespace()
        self.assertIn(Path('/usr/share/keyrings/public.gpg'), selected)

    def test_limited_config_and_binary_conflicts(self):
        values = dict(BOUNDS)
        admit_config(values, after=True)
        values['Binary::apt-get::Acquire::Retries'] = '5'
        with self.assertRaises(RuntimeError): admit_config(values)
        with self.assertRaises(RuntimeError):
            admit_config({**BOUNDS, 'APT::Update::Error-Mode': 'persistent',
                          'Binary::apt-get::APT::Update::Error-Mode': 'persistent'})
        for key, expected in SECURITY.items():
            weakened = {**BOUNDS, key: 'false' if expected == 'true' else 'true'}
            with self.subTest(key=key), self.assertRaises(RuntimeError): admit_config(weakened)

    def test_transient_error_mode_only_before_mutation(self):
        values = {**BOUNDS, 'APT::Update::Error-Mode': 'persistent'}
        admit_config(values)
        with self.assertRaises(RuntimeError): admit_config(values, after=True)

    def test_unexpected_config_subtree_and_duplicate_refused(self):
        self.assertEqual(parse_config(b'Acquire::Retries "1";\n'), {'Acquire::Retries': '1'})
        for raw in (b'Acquire::http::Timeout::host "15";\n', b'Acquire::Retries "1";\nAcquire::Retries "1";\n',
                    b'Acquire::http::Proxy "secret";\n', b'Acquire::Retries "1\\n";\n'):
            with self.subTest(raw=raw), self.assertRaises(RuntimeError): parse_config(raw)

    def test_original_fd_identity_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory).resolve() / 'mirror'
            path.write_bytes(STOCK); path.chmod(0o600)
            original, identity = safe_read(path, os.getuid())
            replace_original(path, original, identity, mirror_candidate(original), os.getuid())
            current, after = safe_read(path, os.getuid())
            self.assertEqual(current, mirror_candidate(STOCK))
            self.assertEqual((after['dev'], after['ino']), (identity['dev'], identity['ino']))

    def test_original_drift_symlink_and_hardlink_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve(); path = root / 'mirror'
            path.write_bytes(STOCK); path.chmod(0o600)
            original, identity = safe_read(path, os.getuid())
            path.write_bytes(b'changed')
            with self.assertRaises(RuntimeError): replace_original(path, original, identity, mirror_candidate(original), os.getuid())
            self.assertEqual(path.read_bytes(), b'changed')
            replacement = root / 'replacement'; replacement.write_bytes(STOCK); replacement.chmod(0o600)
            os.replace(replacement, path)
            with self.assertRaises(RuntimeError):
                replace_original(path, original, identity, mirror_candidate(original), os.getuid())
            self.assertEqual(path.read_bytes(), STOCK)
            link = root / 'symlink'; link.symlink_to(path)
            with self.assertRaises(RuntimeError): safe_read(link, os.getuid())
            os.link(path, root / 'hardlink')
            with self.assertRaises(RuntimeError): safe_read(path, os.getuid())


if __name__ == '__main__':
    unittest.main()

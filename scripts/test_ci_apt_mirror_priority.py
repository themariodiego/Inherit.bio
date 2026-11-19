"""Pure synthetic admission/custody controls; never invoke APT or require root."""
import os
import itertools
import stat
from pathlib import Path
import tempfile
import unittest
from ci_apt_mirror_priority import (STOCK, PRIORITIZED, NETWORK, URIS, BOUNDS, SECURITY, admit_platform, admit_apt_version,
    mirror_candidate, admit_priority_state, admit_sources, parse_config, admit_config, safe_read, replace_original,
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


UNSUPPORTED_MIRROR = 'Unsupported stock mirror URI, priority or format'
# Upstream main's three plausible stock shapes, read from its build script. The us-east-2 one was later observed
# byte for byte on hosted runners and is admitted (EC2_STOCK); the other two remain unobserved and refused.
NO_PRIORITY_ONE = b'https://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n'
AWS_PRIORITY_ONE = b'http://us-east-2.ec2.archive.ubuntu.com/ubuntu/\tpriority:1\n' + NO_PRIORITY_ONE
AZURE_CHANGED = (STOCK.replace(b'azure.archive.ubuntu.com/ubuntu/', b'azure.archive.ubuntu.com/ubuntu'),
                 STOCK[:-1], STOCK.replace(b'\n', b'\r\n'))
# Plain HTTP archive and security rows stay refused whatever a later step admits.
HTTP_ONLY = STOCK.replace(b'https:', b'http:')
# The two source shapes observed with the us-east-2 mirror, in their observed component order: paragraph 2 direct
# (image 20261111.127.1) and both paragraphs on the mirror list (image 20261116.133.1).
OBSERVED_SOURCE = SOURCE.replace(b'main restricted universe multiverse', b'main universe restricted multiverse')
DIRECT_SECURITY_SOURCE = OBSERVED_SOURCE.replace(b'URIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble-security',
                                                 b'URIs: http://security.ubuntu.com/ubuntu\nSuites: noble-security')
EC2_PRIORITIZED_BYTES = (b'http://us-east-2.ec2.archive.ubuntu.com/ubuntu/\tpriority:3\n'
                         b'https://archive.ubuntu.com/ubuntu/\tpriority:1\n'
                         b'https://security.ubuntu.com/ubuntu/\tpriority:2\n')
REFUSAL_EVENTS = ['APT_VERSION_OBSERVED', 'PUBLIC_APT_DIRECTORY_METADATA', 'REFUSED_MIRROR_OBSERVED',
                  'SOURCES_SHAPE_OBSERVED', 'LATE_APT_FRAGMENTS_OBSERVED']


def run_main(mirror, strict=None, sources=SOURCE, fragments=('00synthetic', 'zz-snapshot'), prepare=None, extra=()):
    # The real main() over owned synthetic files. Platform, version text and directory census are fixed doubles;
    # limited_config is a stop, so no APT command can run. Fragment bytes are private and must never appear.
    import io
    import json
    from contextlib import ExitStack, redirect_stdout
    from types import SimpleNamespace
    from unittest.mock import patch
    from ci_apt_mirror_priority import main
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory).resolve(); config = root / 'apt.conf.d'; config.mkdir()
        paths = SimpleNamespace(mirror=root / 'apt-mirrors.txt', sources=root / 'ubuntu.sources',
                                strict=config / 'zzzz-inherit-ci-network.conf')
        for path, raw in ((paths.mirror, mirror), (paths.sources, sources), (paths.strict, strict)):
            if raw is not None:
                path.write_bytes(raw); path.chmod(0o644)
        for name in fragments:
            (config / name).write_bytes(b'private_fixture_text\n')
        if prepare is not None:
            prepare(paths)
        owner, output = os.getuid(), io.StringIO()
        version = SimpleNamespace(returncode=0, stdout=b'apt 2.8.4 (amd64)\n', stderr=b'')
        result = SimpleNamespace(error=None)
        def read(path, uid=0):
            # safe_read's open blocks on a FIFO; the double fails instead, so a missing guard fails rather than hangs.
            if stat.S_ISFIFO(os.lstat(path).st_mode):
                raise AssertionError('blocking open of a FIFO')
            return safe_read(path, owner)
        with ExitStack() as stack:
            result.reads = stack.enter_context(patch('ci_apt_mirror_priority.safe_read', side_effect=read))
            result.run = stack.enter_context(patch('ci_apt_mirror_priority.subprocess.run', return_value=version))
            result.listed = stack.enter_context(patch('ci_apt_mirror_priority.os.listdir', wraps=os.listdir))
            # Later patchers win, so a test's extra doubles replace the defaults above.
            for patcher in (patch('ci_apt_mirror_priority.MIRROR', paths.mirror),
                            patch('ci_apt_mirror_priority.SOURCES', paths.sources),
                            patch('ci_apt_mirror_priority.STRICT', paths.strict),
                            patch('ci_apt_mirror_priority.platform.system', return_value='Linux'),
                            patch('ci_apt_mirror_priority.platform.machine', return_value='x86_64'),
                            patch('ci_apt_mirror_priority.os.getuid', return_value=0),
                            patch.object(Path, 'read_text', return_value='ID=ubuntu\nVERSION_ID="24.04"\n'),
                            patch('ci_apt_mirror_priority.fixed_directory_diagnostics', return_value=[]),
                            patch('ci_apt_mirror_priority.limited_config',
                                  side_effect=RuntimeError('synthetic stop after source admission')), *extra):
                stack.enter_context(patcher)
            stack.enter_context(redirect_stdout(output))
            try:
                main(['ubuntu24', '20261116.1.1', 'true', 'github-hosted'])
            except Exception as error:
                result.error = error
        result.text = output.getvalue()
        result.events = [json.loads(line) for line in result.text.splitlines()]
        result.paths = paths
        result.mirror_after = paths.mirror.read_bytes()
        result.strict_after = paths.strict.read_bytes() if paths.strict.exists() else None
        return result


def run_main_admitted(mirror, strict=None, sources=OBSERVED_SOURCE, fragments=('00synthetic', 'zz-retries')):
    # run_main through to PASS. Root-owned stat views, keyring repair, census, config dump and the update command are
    # doubles; every custody read, the strict fragment write and the mirror rewrite run for real on owned files.
    import json
    from types import SimpleNamespace
    from unittest.mock import patch
    real_mkdtemp, real_path = tempfile.mkdtemp, Path
    with tempfile.TemporaryDirectory() as directory:
        aux = Path(directory).resolve()
        def as_root(original):
            def observed(*args, **kwargs):
                info = original(*args, **kwargs)
                values = {name: getattr(info, name) for name in dir(info) if name.startswith('st_')}
                values.update(st_uid=0, st_gid=0)
                return SimpleNamespace(**values)
            return observed
        def read(path, uid=0):
            if stat.S_ISFIFO(os.lstat(path).st_mode):
                raise AssertionError('blocking open of a FIFO')
            return safe_read(path, 0)
        updates, pipes = [], []
        def update(argv, **kwargs):
            out, into = os.pipe(); os.close(into)
            pipes.append(os.fdopen(out, 'rb')); updates.append(argv)
            return SimpleNamespace(stdout=pipes[-1], wait=lambda: 0)
        def path(value, *rest):
            return aux / 'absent-apt.conf' if str(value) == '/etc/apt/apt.conf' else real_path(value, *rest)
        extra = (patch('ci_apt_mirror_priority.os.fstat', side_effect=as_root(os.fstat)),
                 patch('ci_apt_mirror_priority.os.lstat', side_effect=as_root(os.lstat)),
                 patch('ci_apt_mirror_priority.os.stat', side_effect=as_root(os.stat)),
                 patch('ci_apt_mirror_priority.safe_read', side_effect=read),
                 patch('ci_apt_mirror_priority.Path', side_effect=path),
                 patch('ci_apt_mirror_priority.tempfile.mkdtemp', side_effect=lambda prefix, dir: real_mkdtemp(prefix=prefix, dir=aux)),
                 patch('ci_apt_mirror_priority.limited_config', return_value=(b'synthetic limited config\n', dict(BOUNDS))),
                 patch('ci_apt_mirror_priority.harden_original_keyring_permissions',
                       return_value={'decision': 'PERMISSIONS_HARDENED', 'admittedKeyringInputs': []}),
                 patch('ci_apt_mirror_priority.source_snapshot', return_value=[]),
                 patch('ci_apt_mirror_priority.subprocess.Popen', side_effect=update))
        result = run_main(mirror, strict, sources, fragments, prepare=lambda paths: paths.strict.parent.chmod(0o755),
                          extra=extra)
        for pipe in pipes:
            pipe.close()
        result.updates = updates
        records = list(aux.glob('inherit-ci-apt-*/admission.json'))
        result.admission = json.loads(records[0].read_bytes()) if records else None
        return result


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

    def test_exact_priority_operation_applies_twice_without_changing_owned_result(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve(); mirror = root / 'mirror'; strict = root / 'strict'
            mirror.write_bytes(STOCK); mirror.chmod(0o600)
            original, identity = safe_read(mirror, os.getuid())
            candidate, repeated = admit_priority_state(original, None)
            self.assertFalse(repeated)
            replace_original(mirror, original, identity, candidate, os.getuid())
            strict.write_bytes(NETWORK); strict.chmod(0o600)
            first_mirror = safe_read(mirror, os.getuid()); first_strict = safe_read(strict, os.getuid())
            second, repeated = admit_priority_state(first_mirror[0], first_strict[0])
            self.assertTrue(repeated)
            self.assertEqual(second, PRIORITIZED)
            self.assertEqual(mirror_candidate(second), second)
            self.assertEqual(safe_read(mirror, os.getuid()), first_mirror)
            self.assertEqual(safe_read(strict, os.getuid()), first_strict)

    def test_readmission_refuses_partial_spoofed_or_unpaired_states(self):
        for mirror, strict in ((STOCK, NETWORK), (PRIORITIZED, None),
                               (PRIORITIZED, NETWORK.replace(b'"1"', b'"2"', 1)),
                               (PRIORITIZED, NETWORK + b'Acquire::AllowInsecureRepositories "true";\n'),
                               (PRIORITIZED.replace(b'https:', b'http:'), NETWORK),
                               (PRIORITIZED.replace(b'priority:2', b'priority:3'), NETWORK),
                               (PRIORITIZED[:-1], NETWORK),
                               (PRIORITIZED + PRIORITIZED.splitlines(keepends=True)[0], NETWORK),
                               (PRIORITIZED.replace(b'archive.ubuntu.com/', b'user:secret@archive.ubuntu.com/'), NETWORK)):
            with self.subTest(mirror=mirror, strict=strict), self.assertRaises(RuntimeError):
                admit_priority_state(mirror, strict)

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

    def test_admitted_stock_and_prioritized_candidates_are_byte_identical(self):
        reviewed = (b'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n'
                    b'https://archive.ubuntu.com/ubuntu/\tpriority:2\n'
                    b'https://security.ubuntu.com/ubuntu/\tpriority:3\n')
        prioritized = (b'http://azure.archive.ubuntu.com/ubuntu/\tpriority:3\n'
                       b'https://archive.ubuntu.com/ubuntu/\tpriority:1\n'
                       b'https://security.ubuntu.com/ubuntu/\tpriority:2\n')
        self.assertEqual((STOCK, PRIORITIZED), (reviewed, prioritized))
        self.assertEqual(mirror_candidate(STOCK), prioritized)
        self.assertEqual(mirror_candidate(PRIORITIZED), prioritized)
        self.assertEqual(admit_priority_state(STOCK, None), (prioritized, False))
        self.assertEqual(admit_priority_state(PRIORITIZED, NETWORK), (prioritized, True))

    def test_previously_refused_mirror_states_keep_their_exact_reasons(self):
        from ci_apt_mirror_priority import EC2_PRIORITIZED
        mismatched = 'Mirror and strict configuration state differ'
        credential = b'user:secret@archive.ubuntu.com/'
        shapes = [STOCK.replace(b'https:', b'http:'), STOCK.replace(b'priority:2', b'priority:1'), STOCK[:-1],
                  STOCK + STOCK.splitlines(keepends=True)[0], STOCK.replace(b'archive.ubuntu.com/', credential),
                  PRIORITIZED.replace(b'https:', b'http:'), PRIORITIZED.replace(b'priority:2', b'priority:3'),
                  PRIORITIZED[:-1], PRIORITIZED + PRIORITIZED.splitlines(keepends=True)[0],
                  PRIORITIZED.replace(b'archive.ubuntu.com/', credential), NO_PRIORITY_ONE,
                  *AZURE_CHANGED, b'', b'\xff']
        cases = [(raw, strict, UNSUPPORTED_MIRROR) for raw in shapes for strict in (None, NETWORK)]
        cases += [(STOCK, NETWORK, mismatched), (PRIORITIZED, None, mismatched),
                  (PRIORITIZED, NETWORK.replace(b'"1"', b'"2"', 1), mismatched),
                  (PRIORITIZED, NETWORK + b'Acquire::AllowInsecureRepositories "true";\n', mismatched),
                  # The observed us-east-2 mirror is now admitted alone, so only its unpaired states stay refused.
                  (AWS_PRIORITY_ONE, NETWORK, mismatched), (EC2_PRIORITIZED, None, mismatched)]
        for raw, strict, reason in cases:
            with self.subTest(raw=raw, strict=strict):
                with self.assertRaises(RuntimeError) as raised:
                    admit_priority_state(raw, strict)
                self.assertEqual((type(raised.exception), str(raised.exception)), (RuntimeError, reason))
                if reason == UNSUPPORTED_MIRROR:
                    with self.assertRaises(RuntimeError) as direct:
                        mirror_candidate(raw)
                    self.assertEqual(str(direct.exception), UNSUPPORTED_MIRROR)

    def test_unobserved_new_stock_shapes_are_disclosed_and_still_refused(self):
        import hashlib
        from ci_apt_mirror_priority import refused_mirror_diagnostics
        for raw in (NO_PRIORITY_ONE, AZURE_CHANGED[0]):
            with self.subTest(raw=raw):
                with self.assertRaisesRegex(RuntimeError, '^' + UNSUPPORTED_MIRROR + '$'):
                    mirror_candidate(raw)
                observed = refused_mirror_diagnostics(raw, 'ubuntu24', '20261116.1.1')
                rows = [line['publicRow'] for line in observed['lines']]
                self.assertEqual(observed['event'], 'REFUSED_MIRROR_OBSERVED')
                self.assertEqual((observed['imageOS'], observed['imageVersion']), ('ubuntu24', '20261116.1.1'))
                self.assertEqual((observed['byteLength'], observed['lineCount'], observed['sha256']),
                                 (len(raw), len(raw.splitlines()), hashlib.sha256(raw).hexdigest()))
                self.assertTrue(observed['bounded'] and observed['finalNewline'])
                self.assertEqual([line['index'] for line in observed['lines']], list(range(1, len(rows) + 1)))
                # The public rows alone reproduce the exact refused bytes, so step two needs no guessing.
                self.assertEqual(('\n'.join(rows) + '\n').encode(), raw)
        self.assertEqual([row['publicRow'] for row in refused_mirror_diagnostics(AWS_PRIORITY_ONE, 'ubuntu24',
                          '20261116.1.1')['lines']][0], 'http://us-east-2.ec2.archive.ubuntu.com/ubuntu/\tpriority:1')
        missing_newline, crlf = (refused_mirror_diagnostics(raw, 'ubuntu24', '20261116.1.1') for raw in AZURE_CHANGED[1:])
        self.assertEqual((missing_newline['lineCount'], missing_newline['finalNewline']), (3, False))
        self.assertEqual(missing_newline['lines'][0]['publicRow'], URIS[0] + '\tpriority:1')
        self.assertEqual([set(line) for line in crlf['lines']], [{'index', 'byteLength', 'sha256'}] * 3)

    def test_refused_mirror_lines_outside_the_strict_public_row_are_length_and_hash_only(self):
        import hashlib
        from ci_apt_mirror_priority import refused_mirror_diagnostics
        public = b'https://archive.ubuntu.com/ubuntu/\tpriority:2'
        hidden = [public.replace(b'archive.ubuntu.com/', b'user:secret@archive.ubuntu.com/'),
                  b'http://mirror.example/ubuntu/\tpriority:1', b'https://archive.ubuntu.com.example/ubuntu/\tpriority:2',
                  public.replace(b'//archive.', b'//private'), b'http://archive.ubuntu.com@mirror.example/ubuntu/\tpriority:1',
                  b'http://archive.ubuntu.com:8080/ubuntu/\tpriority:1', b'http://ARCHIVE.ubuntu.com/ubuntu/\tpriority:1',
                  b'ftp://archive.ubuntu.com/ubuntu/\tpriority:1', b'https://archive.ubuntu.com/ubuntu-ports/\tpriority:2',
                  b'https://archive.ubuntu.com/ubuntu//\tpriority:2', b'https://archive.ubuntu.com/ubuntu/ priority:2',
                  public + b'0', public + b' ', public + b'\t', public + b'\r', b'\t' + public, b'',
                  public.replace(b'//archive.', b'//' + b'a' * 64 + b'.'), public.replace(b'//archive.', b'//.'),
                  b'private_fixture_text']
        for line in hidden:
            raw = public + b'\n' + line + b'\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n'
            with self.subTest(line=line):
                observed = refused_mirror_diagnostics(raw, 'ubuntu24', '20261116.1.1')
                self.assertEqual(observed['lines'], [{'index': 1, 'publicRow': public.decode()},
                                 {'index': 2, 'byteLength': len(line), 'sha256': hashlib.sha256(line).hexdigest()},
                                 {'index': 3, 'publicRow': 'https://security.ubuntu.com/ubuntu/\tpriority:3'}])
                for private in (b'secret', b'mirror.example', b'private', b'ARCHIVE', b'ftp', b'ports'):
                    if private in line:
                        self.assertNotIn(private.decode(), repr(observed))
        accepted = [b'http://archive.ubuntu.com/ubuntu\tpriority:9'.replace(b'//archive.', b'//'),
                    b'https://a-1.b2.archive.ubuntu.com/ubuntu/\tpriority:0']
        for line in accepted:
            with self.subTest(line=line):
                observed = refused_mirror_diagnostics(line + b'\n', 'ubuntu24', '20261116.1.1')
                self.assertEqual(observed['lines'], [{'index': 1, 'publicRow': line.decode()}])

    def test_refused_mirror_diagnostic_bounds(self):
        import hashlib
        from ci_apt_mirror_priority import refused_mirror_diagnostics
        row = b'https://archive.ubuntu.com/ubuntu/\tpriority:2\n'
        exact = row * 7 + b'#' * (1023 - len(row) * 7) + b'\n'
        over = row * 7 + b'#' * (1024 - len(row) * 7) + b'\n'
        self.assertEqual((len(exact), exact.count(b'\n'), len(over), over.count(b'\n')), (1024, 8, 1025, 8))
        for raw, bounded, lines in ((exact, True, 8), (row * 8, True, 8), (b'', True, 0), (b'\n', True, 1),
                                    (row * 9, False, 9), (over, False, 8), (b'#' * 1025, False, 1),
                                    (row + b'\xff\n', False, 2), (row + 'é'.encode() + b'\n', False, 2),
                                    (b'\n' * 5000, False, 5000)):
            with self.subTest(length=len(raw), lines=lines, bounded=bounded):
                observed = refused_mirror_diagnostics(raw, 'ubuntu24', '20261116.1.1')
                self.assertEqual((observed['bounded'], observed['lineCount'], observed['byteLength'], observed['sha256']),
                                 (bounded, lines, len(raw), hashlib.sha256(raw).hexdigest()))
                summary = {'event', 'imageOS', 'imageVersion', 'lineCount', 'byteLength', 'sha256', 'bounded'}
                self.assertEqual(set(observed), summary | ({'finalNewline', 'lines'} if bounded else set()))
                if bounded:
                    self.assertEqual(len(observed['lines']), lines)
        self.assertEqual(refused_mirror_diagnostics(b'', 'ubuntu24', '20261116.1.1')['lines'], [])

    def test_source_shape_diagnostic_discloses_only_closed_public_tokens(self):
        import hashlib
        from ci_apt_mirror_priority import source_shape_diagnostics
        stock = source_shape_diagnostics(SOURCE)
        self.assertEqual((stock['event'], stock['observation'], stock['bounded'], stock['byteLength'], stock['sha256']),
                         ('SOURCES_SHAPE_OBSERVED', 'observed', True, len(SOURCE), hashlib.sha256(SOURCE).hexdigest()))
        names = ['Types', 'URIs', 'Suites', 'Components', 'Signed-By']
        common = {'Types': 'deb', 'URIs': 'mirror+file:/etc/apt/apt-mirrors.txt',
                  'Components': 'main restricted universe multiverse',
                  'Signed-By': '/usr/share/keyrings/ubuntu-archive-keyring.gpg'}
        self.assertEqual(stock['paragraphs'], [
            {'paragraph': 1, 'fields': names, 'unparsedLines': 0,
             'values': {**common, 'Suites': 'noble noble-updates noble-backports'}},
            {'paragraph': 2, 'fields': names, 'unparsedLines': 0, 'values': {**common, 'Suites': 'noble-security'}}])
        upstream = (b'## Synthetic header comment\n\n## Synthetic paragraph comment\nTypes: deb deb-src\n'
                    b'URIs: http://archive.ubuntu.com/ubuntu\nSuites: noble noble-updates noble-backports\n'
                    b'Components: main universe restricted multiverse\n'
                    b'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n\nTypes: deb\n'
                    b'URIs: http://security.ubuntu.com/ubuntu/\nSuites: noble-security\nComponents: main\n'
                    b'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n')
        observed = source_shape_diagnostics(upstream)['paragraphs']
        self.assertEqual([item['values']['URIs'] for item in observed],
                         ['http://archive.ubuntu.com/ubuntu', 'http://security.ubuntu.com/ubuntu/'])
        self.assertEqual((observed[0]['values']['Types'], observed[1]['values']['Components']), ('deb deb-src', 'main'))
        def hashed(value):
            return {'byteLength': len(value), 'sha256': hashlib.sha256(value.encode()).hexdigest()}
        private = (b'Types: deb  deb-src\nURIs: https://mirror.example/ubuntu\nSuites: noble jammy\n'
                   b'Components: main private_fixture_text\nSigned-By: /etc/apt/keyrings/private_fixture_text.gpg\n'
                   b'Trusted: private_fixture_text\nX-Private-Fixture-Text: 1\n private_fixture_text continuation\n'
                   b'Types: deb\n\nURIs: mirror+file:/etc/apt/apt-mirrors.txt https://archive.ubuntu.com.example/ubuntu\n'
                   b'Suites: \nSigned-By: -----BEGIN PGP PUBLIC KEY BLOCK-----\n .\n')
        observed = source_shape_diagnostics(private)
        self.assertTrue(observed['bounded'])
        first, second = observed['paragraphs']
        self.assertEqual(first['fields'], ['Types', 'URIs', 'Suites', 'Components', 'Signed-By', 'Trusted',
                                           hashed('X-Private-Fixture-Text'), 'Types'])
        self.assertEqual(first['values'], {'Types': hashed('deb  deb-src'), 'URIs': hashed('https://mirror.example/ubuntu'),
                                           'Suites': hashed('noble jammy'), 'Components': hashed('main private_fixture_text'),
                                           'Signed-By': hashed('/etc/apt/keyrings/private_fixture_text.gpg')})
        self.assertEqual(first['unparsedLines'], 1)
        self.assertEqual(second['values'], {'URIs': hashed('mirror+file:/etc/apt/apt-mirrors.txt '
                                                           'https://archive.ubuntu.com.example/ubuntu'),
                                            'Suites': hashed(''), 'Signed-By': hashed('-----BEGIN PGP PUBLIC KEY BLOCK-----')})
        self.assertEqual(second['unparsedLines'], 1)
        for text in ('private_fixture_text', 'Private', 'jammy', 'mirror.example', 'BEGIN', 'keyrings/'):
            self.assertNotIn(text, repr(observed))

    def test_source_shape_diagnostic_bounds(self):
        import hashlib
        from ci_apt_mirror_priority import source_shape_diagnostics
        exact = SOURCE + b'#' * (4095 - len(SOURCE)) + b'\n'
        paragraph = b'Types: deb\n\n'
        for raw, bounded in ((exact, True), (paragraph * 8, True), (b'', True), (exact + b'#', False),
                             (paragraph * 9, False), (b'Types: deb\n' * 16, True), (b'Types: deb\n' * 17, False),
                             (SOURCE.replace(b'noble-security', 'noble-sécurité'.encode()), False),
                             (SOURCE + b'\xff', False)):
            with self.subTest(length=len(raw), bounded=bounded):
                observed = source_shape_diagnostics(raw)
                self.assertEqual((observed['bounded'], observed['byteLength'], observed['sha256']),
                                 (bounded, len(raw), hashlib.sha256(raw).hexdigest()))
                summary = {'event', 'observation', 'byteLength', 'sha256', 'bounded'}
                self.assertEqual(set(observed), summary | ({'paragraphs'} if bounded else set()))
        self.assertEqual(len(exact), 4096)
        self.assertEqual(source_shape_diagnostics(b'')['paragraphs'], [])

    def test_late_fragment_names_are_bounded_and_masked(self):
        from ci_apt_mirror_priority import late_fragment_diagnostics
        names = ['00aptproxy', '20auto-upgrades', 'zy-before', 'zz', 'zz-snapshot', 'zzzz-inherit-ci-network.conf',
                 'zz private_fixture_text', 'zz' + 'a' * 63, 'zz' + 'a' * 62, '~private_fixture_text', 'zz\udcff']
        observed = late_fragment_diagnostics(names)
        self.assertEqual(observed, {'event': 'LATE_APT_FRAGMENTS_OBSERVED', 'observation': 'observed', 'count': 8,
                                    'names': ['zz', 'unsupported', 'zz-snapshot', 'zz' + 'a' * 62, 'unsupported',
                                              'zzzz-inherit-ci-network.conf', 'unsupported', 'unsupported'],
                                    'truncated': False, 'zzSnapshot': True})
        self.assertNotIn('private_fixture_text', repr(observed))
        many = late_fragment_diagnostics([f'zz-{index:02}' for index in range(17)] + ['00early'])
        self.assertEqual((many['count'], len(many['names']), many['truncated'], many['zzSnapshot']), (17, 16, True, False))
        self.assertEqual(late_fragment_diagnostics([])['names'], [])

    def test_main_refusal_reports_bounded_shapes_then_reraises_the_same_refusal(self):
        import hashlib
        from ci_apt_mirror_priority import refused_mirror_diagnostics, source_shape_diagnostics
        for raw in (NO_PRIORITY_ONE, *AZURE_CHANGED, STOCK.replace(b'archive.ubuntu.com/',
                                                                  b'user:secret@archive.ubuntu.com/')):
            for strict in (None, NETWORK):
                with self.subTest(raw=raw, strict=strict):
                    result = run_main(raw, strict)
                    self.assertEqual((type(result.error), str(result.error)), (RuntimeError, UNSUPPORTED_MIRROR))
                    self.assertEqual([event['event'] for event in result.events], REFUSAL_EVENTS)
                    self.assertEqual(result.events[2], refused_mirror_diagnostics(raw, 'ubuntu24', '20261116.1.1'))
                    self.assertEqual(result.events[2]['sha256'], hashlib.sha256(raw).hexdigest())
                    self.assertEqual(result.events[3], source_shape_diagnostics(SOURCE))
                    self.assertEqual(result.events[4]['names'],
                                     ['zz-snapshot'] + (['zzzz-inherit-ci-network.conf'] if strict else []))
                    self.assertTrue(result.events[4]['zzSnapshot'])
                    self.assertEqual([call.args[0] for call in result.run.call_args_list], [['/usr/bin/apt-get', '--version']])
                    self.assertEqual([call.args[0] for call in result.reads.call_args_list],
                                     [result.paths.mirror] + ([result.paths.strict] if strict else []) + [result.paths.sources])
                    for private in ('private_fixture_text', 'secret', '00synthetic'):
                        self.assertNotIn(private, result.text)
                    self.assertEqual(result.mirror_after, raw)

    def test_main_admitted_states_emit_no_refusal_diagnostics(self):
        for raw, strict in ((STOCK, None), (PRIORITIZED, NETWORK)):
            with self.subTest(raw=raw):
                result = run_main(raw, strict)
                self.assertEqual(str(result.error), 'synthetic stop after source admission')
                self.assertEqual([event['event'] for event in result.events], ['APT_VERSION_OBSERVED',
                                 'PUBLIC_APT_DIRECTORY_METADATA', 'COMPONENTS_OBSERVED', 'COMPONENTS_OBSERVED'])
                self.assertEqual(result.events[0], {'event': 'APT_VERSION_OBSERVED', 'installedAptVersion': '2.8.4'})
                self.assertEqual([call.args[0] for call in result.reads.call_args_list],
                                 [result.paths.mirror] + ([result.paths.strict] if strict else []) + [result.paths.sources])
                result.listed.assert_not_called()
                self.assertEqual(result.mirror_after, raw)

    def test_main_earlier_and_unrelated_refusals_are_unchanged(self):
        # A strict-file custody refusal still precedes the mirror check; a pairing refusal discloses nothing new.
        def symlink_strict(paths):
            target = paths.strict.parent.parent / 'strict-target'
            target.write_bytes(NETWORK); paths.strict.symlink_to(target)
        result = run_main(HTTP_ONLY, prepare=symlink_strict)
        self.assertEqual(str(result.error), 'Canonical input path required')
        self.assertEqual([event['event'] for event in result.events], REFUSAL_EVENTS[:2])
        for raw, strict in ((STOCK, NETWORK), (PRIORITIZED, None)):
            with self.subTest(raw=raw):
                result = run_main(raw, strict)
                self.assertEqual(str(result.error), 'Mirror and strict configuration state differ')
                self.assertEqual([event['event'] for event in result.events], REFUSAL_EVENTS[:2])
                result.listed.assert_not_called()

    def test_main_diagnostic_failures_are_fixed_labels_and_never_replace_the_refusal(self):
        from unittest.mock import patch
        def remove_sources(paths): paths.sources.unlink()
        def symlink_sources(paths):
            target = paths.sources.parent / 'sources-target'
            paths.sources.rename(target); paths.sources.symlink_to(target)
        def loosen_sources(paths): paths.sources.chmod(0o666)
        def fifo_sources(paths):
            paths.sources.unlink(); os.mkfifo(paths.sources)
        for name, prepare, expected in (
                ('missing', remove_sources, {'observation': 'custody-refused', 'errorType': 'FileNotFoundError'}),
                ('symlink', symlink_sources, {'observation': 'custody-refused', 'errorType': 'RuntimeError'}),
                ('writable', loosen_sources, {'observation': 'custody-refused', 'errorType': 'RuntimeError'}),
                ('fifo', fifo_sources, {'observation': 'custody-refused', 'errorType': 'RuntimeError'})):
            with self.subTest(sources=name):
                result = run_main(HTTP_ONLY, prepare=prepare)
                self.assertEqual(str(result.error), UNSUPPORTED_MIRROR)
                self.assertEqual([event['event'] for event in result.events], REFUSAL_EVENTS)
                self.assertEqual(result.events[3], {'event': 'SOURCES_SHAPE_OBSERVED', **expected})
                self.assertTrue(result.events[4]['zzSnapshot'])
        failures = {'listing': (patch('ci_apt_mirror_priority.os.listdir', side_effect=PermissionError('private_fixture_text')),
                                4, 'PermissionError'),
                    'mirror-shape': (patch('ci_apt_mirror_priority.refused_mirror_diagnostics',
                                           side_effect=MemoryError('private_fixture_text')), 2, 'MemoryError'),
                    'sources-shape': (patch('ci_apt_mirror_priority.source_shape_diagnostics',
                                            side_effect=ValueError('private_fixture_text')), 3, 'ValueError')}
        for name, (patcher, index, error_type) in failures.items():
            with self.subTest(failure=name):
                result = run_main(HTTP_ONLY, extra=(patcher,))
                self.assertEqual((type(result.error), str(result.error)), (RuntimeError, UNSUPPORTED_MIRROR))
                self.assertEqual([event['event'] for event in result.events], REFUSAL_EVENTS)
                self.assertEqual(result.events[index], {'event': REFUSAL_EVENTS[index], 'observation': 'unavailable',
                                                        'errorType': error_type})
                self.assertNotIn('private_fixture_text', result.text)
        import builtins
        original_print = builtins.print
        def failing_print(*args, **kwargs):
            if 'REFUSED_MIRROR' in args[0] or 'SHAPE' in args[0] or 'LATE_APT' in args[0]:
                raise OSError('private_fixture_text')
            original_print(*args, **kwargs)
        result = run_main(HTTP_ONLY, extra=(patch('ci_apt_mirror_priority.print', create=True,
                                                        side_effect=failing_print),))
        self.assertEqual((type(result.error), str(result.error)), (RuntimeError, UNSUPPORTED_MIRROR))
        self.assertEqual([event['event'] for event in result.events], REFUSAL_EVENTS[:2])

    def test_us_east_2_mirror_is_exactly_the_hosted_observation(self):
        import hashlib
        import json
        from ci_apt_mirror_priority import EC2_STOCK, refused_mirror_diagnostics
        hosted = ('{"bounded": true, "byteLength": 152, "event": "REFUSED_MIRROR_OBSERVED", "finalNewline": true, '
                  '"imageOS": "ubuntu24", "imageVersion": "%s", "lineCount": 3, "lines": [{"index": 1, "publicRow": '
                  '"http://us-east-2.ec2.archive.ubuntu.com/ubuntu/\\tpriority:1"}, {"index": 2, "publicRow": '
                  '"https://archive.ubuntu.com/ubuntu/\\tpriority:2"}, {"index": 3, "publicRow": '
                  '"https://security.ubuntu.com/ubuntu/\\tpriority:3"}], "sha256": '
                  '"af9816b59bc904eaf28838ae673ac2b625b6628bebfc67a7cbeae78ba06e226a"}')
        self.assertEqual((EC2_STOCK, len(EC2_STOCK), hashlib.sha256(EC2_STOCK).hexdigest()),
                         (AWS_PRIORITY_ONE, 152, 'af9816b59bc904eaf28838ae673ac2b625b6628bebfc67a7cbeae78ba06e226a'))
        for version in ('20261111.127.1', '20261116.133.1'):
            with self.subTest(version=version):
                self.assertEqual(refused_mirror_diagnostics(EC2_STOCK, 'ubuntu24', version), json.loads(hosted % version))

    def test_admitted_states_are_closed_data_changing_only_three_priority_tokens(self):
        from ci_apt_mirror_priority import STATES, EC2_STOCK, EC2_PRIORITIZED, MIRROR_ROUTE, mirror_state
        self.assertEqual([state[:2] for state in STATES], [(STOCK, PRIORITIZED), (EC2_STOCK, EC2_PRIORITIZED)])
        self.assertEqual(EC2_PRIORITIZED, EC2_PRIORITIZED_BYTES)
        self.assertEqual([state[2] for state in STATES],
                         [(MIRROR_ROUTE,), ('http://security.ubuntu.com/ubuntu', MIRROR_ROUTE)])
        self.assertEqual(MIRROR_ROUTE, 'mirror+file:/etc/apt/apt-mirrors.txt')
        for stock, approved, _ in STATES:
            with self.subTest(stock=stock):
                before = [line.split(b'\tpriority:') for line in stock.splitlines()]
                after = [line.split(b'\tpriority:') for line in approved.splitlines()]
                self.assertEqual([row[0] for row in before], [row[0] for row in after])
                self.assertEqual(([row[1] for row in before], [row[1] for row in after]), ([b'1', b'2', b'3'], [b'3', b'1', b'2']))
                changed = [index for index, (a, b) in enumerate(zip(stock, approved)) if a != b]
                self.assertEqual((len(stock), len(changed)), (len(approved), 3))
                self.assertTrue(all(chr(stock[index]).isdigit() for index in changed))
                # HTTPS archive first, HTTPS security second, the plain HTTP regional mirror last.
                self.assertEqual([row[0].split(b'://')[0] for row in sorted(after, key=lambda row: row[1])],
                                 [b'https', b'https', b'http'])
                self.assertEqual(mirror_state(stock), mirror_state(approved))
        # Ambiguous admission data refuses rather than choosing a row.
        from unittest.mock import patch
        with patch('ci_apt_mirror_priority.STATES', STATES + (STATES[1],)), \
                self.assertRaisesRegex(RuntimeError, '^' + UNSUPPORTED_MIRROR + '$'):
            mirror_candidate(EC2_STOCK)

    def test_us_east_2_candidates_and_strict_pairing_match_the_azure_state(self):
        from ci_apt_mirror_priority import EC2_STOCK, EC2_PRIORITIZED
        self.assertEqual(mirror_candidate(EC2_STOCK), EC2_PRIORITIZED_BYTES)
        self.assertEqual(mirror_candidate(EC2_PRIORITIZED), EC2_PRIORITIZED_BYTES)
        self.assertEqual(admit_priority_state(EC2_STOCK, None), (EC2_PRIORITIZED_BYTES, False))
        self.assertEqual(admit_priority_state(EC2_PRIORITIZED, NETWORK), (EC2_PRIORITIZED_BYTES, True))
        for mirror, strict in ((EC2_STOCK, NETWORK), (EC2_PRIORITIZED, None), (EC2_PRIORITIZED, NETWORK + b'\n'),
                               (EC2_PRIORITIZED, NETWORK.replace(b'"15"', b'"16"', 1))):
            with self.subTest(mirror=mirror, strict=strict), \
                    self.assertRaisesRegex(RuntimeError, '^Mirror and strict configuration state differ$'):
                admit_priority_state(mirror, strict)

    def test_every_one_byte_variant_of_an_admitted_mirror_is_refused(self):
        from ci_apt_mirror_priority import EC2_STOCK, EC2_PRIORITIZED
        admitted = {STOCK, PRIORITIZED, EC2_STOCK, EC2_PRIORITIZED}
        for raw in sorted(admitted):
            variants = {raw[:index] + bytes([byte]) + raw[index + 1:] for index in range(len(raw))
                        for byte in {raw[index] ^ 1, ord('x'), ord('\n')} if byte != raw[index]}
            variants |= {raw[:index] + raw[index + 1:] for index in range(len(raw))}
            variants |= {raw[:index] + extra + raw[index:] for index in range(len(raw) + 1) for extra in (b'x', b'\n', b'/')}
            self.assertFalse(variants & admitted)
            for variant in variants:
                with self.assertRaises(RuntimeError) as raised:
                    mirror_candidate(variant)
                self.assertEqual(str(raised.exception), UNSUPPORTED_MIRROR, variant)

    def test_sources_routes_with_the_us_east_2_mirror_are_exactly_the_two_observed(self):
        from ci_apt_mirror_priority import EC2_STOCK, mirror_state
        routes = mirror_state(EC2_STOCK)[2]
        admit_sources(DIRECT_SECURITY_SOURCE, None, routes)
        admit_sources(OBSERVED_SOURCE, None, routes)
        direct = b'URIs: http://security.ubuntu.com/ubuntu\nSuites: noble-security'
        for uri in (b'http://security.ubuntu.com/ubuntu/', b'https://security.ubuntu.com/ubuntu',
                    b'http://archive.ubuntu.com/ubuntu', b'http://Security.ubuntu.com/ubuntu',
                    b'http://security.ubuntu.com/ubunt', b'http://security.ubuntu.com/ubuntu-ports',
                    b'http://security.ubuntu.com', b'http://us-east-2.ec2.archive.ubuntu.com/ubuntu',
                    b'http://security.ubuntu.com/ubuntu http://archive.ubuntu.com/ubuntu',
                    b'mirror+file:/etc/apt/apt-mirrors.txt http://security.ubuntu.com/ubuntu',
                    b'mirror+file:/etc/apt/apt-mirrors', b'mirror+file:/etc/apt/apt-mirrors.txt/', b''):
            with self.subTest(uri=uri), self.assertRaisesRegex(RuntimeError, '^Stock mirror route required$'):
                admit_sources(DIRECT_SECURITY_SOURCE.replace(direct, b'URIs: ' + uri + b'\nSuites: noble-security'),
                              None, routes)
        first = b'URIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble noble-updates noble-backports'
        mirrored, direct_paragraph = DIRECT_SECURITY_SOURCE.split(b'\n\n')
        swapped = direct_paragraph + b'\n' + mirrored + b'\n'
        self.assertIn(direct, swapped.split(b'\n\n')[0])
        both_direct = DIRECT_SECURITY_SOURCE.replace(first, b'URIs: http://security.ubuntu.com/ubuntu\n'
                                                     b'Suites: noble noble-updates noble-backports')
        for raw in (swapped, both_direct):
            with self.subTest(raw=raw), self.assertRaisesRegex(RuntimeError, '^Stock mirror route required$'):
                admit_sources(raw, None, routes)
        # The direct route carries exactly noble-security; the mirror route keeps the Azure state's suite latitude.
        split = DIRECT_SECURITY_SOURCE.replace(b'Suites: noble noble-updates noble-backports', b'Suites: noble noble-backports')
        for suites in (b'noble-updates noble-security', b'noble-security noble-updates'):
            with self.subTest(suites=suites), self.assertRaisesRegex(RuntimeError, '^Stock direct security suite required$'):
                admit_sources(split.replace(b'Suites: noble-security', b'Suites: ' + suites), None, routes)
        moved = DIRECT_SECURITY_SOURCE.replace(b'Suites: noble noble-updates noble-backports',
                                               b'Suites: noble noble-updates noble-backports noble-security')
        with self.assertRaisesRegex(RuntimeError, '^Stock direct security suite required$'):
            admit_sources(moved.replace(b'Suites: noble-security', b'Suites: noble-proposed'), None, routes)
        mirrored_split = OBSERVED_SOURCE.replace(b'Suites: noble noble-updates noble-backports', b'Suites: noble noble-backports')
        admit_sources(mirrored_split.replace(b'Suites: noble-security', b'Suites: noble-updates noble-security'), None, routes)

    def test_azure_state_sources_rule_is_unchanged(self):
        from ci_apt_mirror_priority import mirror_state, MIRROR_ROUTE
        self.assertEqual(mirror_state(STOCK)[2], (MIRROR_ROUTE,))
        self.assertEqual(mirror_state(PRIORITIZED)[2], (MIRROR_ROUTE,))
        for routes in ((), (mirror_state(STOCK)[2],)):
            admit_sources(SOURCE, None, *routes)
            admit_sources(OBSERVED_SOURCE, None, *routes)
            split = SOURCE.replace(b'Suites: noble noble-updates noble-backports', b'Suites: noble noble-backports')
            admit_sources(split.replace(b'Suites: noble-security', b'Suites: noble-updates noble-security'), None, *routes)
            with self.subTest(routes=routes), self.assertRaisesRegex(RuntimeError, '^Stock mirror route required$'):
                admit_sources(DIRECT_SECURITY_SOURCE, None, *routes)

    def test_main_admits_both_observed_us_east_2_states_end_to_end(self):
        from ci_apt_mirror_priority import EC2_STOCK, EC2_PRIORITIZED
        for sources in (DIRECT_SECURITY_SOURCE, OBSERVED_SOURCE):
            for mirror, strict, state in ((EC2_STOCK, None, 'original-stock'),
                                          (EC2_PRIORITIZED, NETWORK, 'exact-prioritized-readmission')):
                with self.subTest(sources=sources, mirror=mirror):
                    result = run_main_admitted(mirror, strict, sources)
                    self.assertIsNone(result.error)
                    self.assertEqual([event.get('event', event.get('decision')) for event in result.events][:6],
                                     ['APT_VERSION_OBSERVED', 'PUBLIC_APT_DIRECTORY_METADATA', 'COMPONENTS_OBSERVED',
                                      'COMPONENTS_OBSERVED', 'PERMISSIONS_HARDENED', 'ADMITTED'])
                    self.assertEqual(result.events[-1]['decision'], 'PASS')
                    self.assertEqual((result.mirror_after, result.strict_after), (EC2_PRIORITIZED_BYTES, NETWORK))
                    self.assertEqual((result.admission['priorityState'], result.admission['mirrorOriginal']),
                                     (state, mirror.decode()))
                    self.assertEqual(result.updates, [['/usr/bin/apt-get', 'update', '--error-on=any']])
                    self.assertEqual([call.args[0] for call in result.run.call_args_list], [['/usr/bin/apt-get', '--version']])
                    self.assertFalse({'REFUSED_MIRROR_OBSERVED', 'SOURCES_SHAPE_OBSERVED'} & {event.get('event') for event in result.events})

    def test_main_admits_the_azure_state_end_to_end_unchanged(self):
        for mirror, strict, state in ((STOCK, None, 'original-stock'), (PRIORITIZED, NETWORK, 'exact-prioritized-readmission')):
            with self.subTest(mirror=mirror):
                result = run_main_admitted(mirror, strict, SOURCE)
                self.assertIsNone(result.error)
                self.assertEqual(result.events[-1]['decision'], 'PASS')
                self.assertEqual((result.mirror_after, result.strict_after), (PRIORITIZED, NETWORK))
                self.assertEqual((result.admission['priorityState'], result.admission['mirrorOriginal']), (state, mirror.decode()))

    def test_main_refuses_unobserved_mirror_and_sources_pairings(self):
        from ci_apt_mirror_priority import EC2_STOCK, EC2_PRIORITIZED, source_shape_diagnostics
        for mirror, strict, sources in ((STOCK, None, DIRECT_SECURITY_SOURCE), (PRIORITIZED, NETWORK, DIRECT_SECURITY_SOURCE),
                                        (EC2_STOCK, None, DIRECT_SECURITY_SOURCE.replace(b'security.ubuntu.com/ubuntu\n',
                                                                                         b'security.ubuntu.com/ubuntu/\n')),
                                        (EC2_PRIORITIZED, NETWORK, DIRECT_SECURITY_SOURCE.replace(b'URIs: http:', b'URIs: https:'))):
            with self.subTest(mirror=mirror, sources=sources):
                result = run_main_admitted(mirror, strict, sources)
                self.assertEqual((type(result.error), str(result.error)), (RuntimeError, 'Stock mirror route required'))
                self.assertEqual([event['event'] for event in result.events],
                                 ['APT_VERSION_OBSERVED', 'PUBLIC_APT_DIRECTORY_METADATA', 'COMPONENTS_OBSERVED',
                                  'SOURCES_SHAPE_OBSERVED', 'LATE_APT_FRAGMENTS_OBSERVED'])
                self.assertEqual(result.events[3], source_shape_diagnostics(sources))
                self.assertEqual((result.mirror_after, result.strict_after, result.updates, result.admission),
                                 (mirror, strict, [], None))
        for variant in (EC2_STOCK.replace(b'us-east-2', b'us-east-1'), EC2_STOCK[:-1], EC2_STOCK.replace(b'ubuntu/\t', b'ubuntu\t', 1),
                        EC2_PRIORITIZED.replace(b'priority:3', b'priority:4')):
            with self.subTest(variant=variant):
                result = run_main_admitted(variant, None, DIRECT_SECURITY_SOURCE)
                self.assertEqual((type(result.error), str(result.error)), (RuntimeError, UNSUPPORTED_MIRROR))
                self.assertEqual([event['event'] for event in result.events], REFUSAL_EVENTS)
                self.assertEqual((result.mirror_after, result.strict_after, result.updates), (variant, None, []))

    def test_main_sources_refusal_reports_the_bytes_read_then_reraises_the_same_refusal(self):
        from unittest.mock import patch
        from ci_apt_mirror_priority import EC2_STOCK, EC2_PRIORITIZED, source_shape_diagnostics
        owner = os.getuid()
        def read_then_replace(path, uid=0):
            # Any re-read would see these private bytes instead of the bytes admission refused.
            raw = safe_read(path, owner)
            if path.name == 'ubuntu.sources':
                path.write_bytes(b'private_fixture_text\n')
            return raw
        split = DIRECT_SECURITY_SOURCE.replace(b'Suites: noble noble-updates noble-backports', b'Suites: noble noble-backports')
        cases = ((EC2_STOCK, None, DIRECT_SECURITY_SOURCE.replace(b'ubuntu.com/ubuntu\nSuites: noble-security',
                                                                  b'ubuntu.com/ubuntu/\nSuites: noble-security'), 'Stock mirror route required'),
                 (STOCK, None, DIRECT_SECURITY_SOURCE, 'Stock mirror route required'),
                 (EC2_PRIORITIZED, NETWORK, split.replace(b'Suites: noble-security', b'Suites: noble-updates noble-security'),
                  'Stock direct security suite required'),
                 (STOCK, None, SOURCE + b'Trusted: yes\n', 'Unsupported Ubuntu source or trust override'),
                 (EC2_STOCK, None, OBSERVED_SOURCE.replace(b' multiverse', b'', 1), 'Stock Ubuntu components required'))
        for mirror, strict, sources, reason in cases:
            with self.subTest(mirror=mirror, sources=sources):
                result = run_main(mirror, strict, sources, extra=(patch('ci_apt_mirror_priority.safe_read',
                                                                        side_effect=read_then_replace),))
                self.assertEqual((type(result.error), str(result.error)), (RuntimeError, reason))
                self.assertEqual([event['event'] for event in result.events][-2:],
                                 ['SOURCES_SHAPE_OBSERVED', 'LATE_APT_FRAGMENTS_OBSERVED'])
                self.assertEqual(result.events[-2], source_shape_diagnostics(sources))
                self.assertEqual(result.events[-1]['names'], ['zz-snapshot'] + (['zzzz-inherit-ci-network.conf'] if strict else []))
                self.assertNotIn('REFUSED_MIRROR_OBSERVED', result.text)
                self.assertNotIn('private_fixture_text', result.text)
                self.assertEqual((result.mirror_after, result.strict_after), (mirror, strict))
                self.assertEqual([call.args[0] for call in result.run.call_args_list], [['/usr/bin/apt-get', '--version']])

    def test_main_admitted_states_print_no_sources_refusal_report(self):
        from ci_apt_mirror_priority import EC2_STOCK, EC2_PRIORITIZED
        for mirror, strict, sources in ((STOCK, None, SOURCE), (PRIORITIZED, NETWORK, SOURCE),
                                        (EC2_STOCK, None, DIRECT_SECURITY_SOURCE), (EC2_PRIORITIZED, NETWORK, DIRECT_SECURITY_SOURCE),
                                        (EC2_STOCK, None, OBSERVED_SOURCE), (EC2_PRIORITIZED, NETWORK, OBSERVED_SOURCE)):
            with self.subTest(mirror=mirror, sources=sources):
                result = run_main_admitted(mirror, strict, sources)
                self.assertIsNone(result.error)
                self.assertFalse({'SOURCES_SHAPE_OBSERVED', 'LATE_APT_FRAGMENTS_OBSERVED', 'REFUSED_MIRROR_OBSERVED'}
                                 & {event.get('event') for event in result.events})

    def test_main_sources_report_failures_are_fixed_labels_and_never_replace_the_refusal(self):
        import builtins
        from unittest.mock import patch
        failures = {'shape': (patch('ci_apt_mirror_priority.source_shape_diagnostics', side_effect=ValueError('private_fixture_text')),
                              'SOURCES_SHAPE_OBSERVED', 'ValueError'),
                    'listing': (patch('ci_apt_mirror_priority.os.listdir', side_effect=PermissionError('private_fixture_text')),
                                'LATE_APT_FRAGMENTS_OBSERVED', 'PermissionError')}
        for name, (patcher, event, error_type) in failures.items():
            with self.subTest(failure=name):
                result = run_main(STOCK, None, DIRECT_SECURITY_SOURCE, extra=(patcher,))
                self.assertEqual((type(result.error), str(result.error)), (RuntimeError, 'Stock mirror route required'))
                self.assertIn({'event': event, 'observation': 'unavailable', 'errorType': error_type}, result.events)
                self.assertEqual([item['event'] for item in result.events][-2:], ['SOURCES_SHAPE_OBSERVED', 'LATE_APT_FRAGMENTS_OBSERVED'])
                self.assertNotIn('private_fixture_text', result.text)
        original_print = builtins.print
        def failing_print(*args, **kwargs):
            if 'SHAPE' in args[0] or 'LATE_APT' in args[0]:
                raise OSError('private_fixture_text')
            original_print(*args, **kwargs)
        result = run_main(STOCK, None, DIRECT_SECURITY_SOURCE,
                          extra=(patch('ci_apt_mirror_priority.print', create=True, side_effect=failing_print),))
        self.assertEqual((type(result.error), str(result.error)), (RuntimeError, 'Stock mirror route required'))
        self.assertEqual([item['event'] for item in result.events],
                         ['APT_VERSION_OBSERVED', 'PUBLIC_APT_DIRECTORY_METADATA', 'COMPONENTS_OBSERVED'])


if __name__ == '__main__':
    unittest.main()

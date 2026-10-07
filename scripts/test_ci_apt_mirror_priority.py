"""Pure synthetic admission/custody controls; never invoke APT or require root."""
import os
import itertools
import stat
from pathlib import Path
import tempfile
import unittest
from ci_apt_mirror_priority import (STOCK, URIS, BOUNDS, SECURITY, admit_platform, admit_apt_version,
    mirror_candidate, admit_sources, parse_config, admit_config, safe_read, replace_original,
    component_diagnostics, config_diagnostics, PREFLIGHT_DIRECTORIES, fixed_directory_diagnostics)

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


class AdmissionTests(unittest.TestCase):
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

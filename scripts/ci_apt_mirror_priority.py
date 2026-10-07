#!/usr/bin/env python3
"""Admit the stock disposable Ubuntu runner before changing three mirror priorities.

The guarded CLI runs as root on hosted Linux only. Pure helpers do not invoke APT.
"""
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import stat
import subprocess
import sys
import tempfile

MIRROR = Path('/etc/apt/apt-mirrors.txt')
SOURCES = Path('/etc/apt/sources.list.d/ubuntu.sources')
STRICT = Path('/etc/apt/apt.conf.d/zzzz-inherit-ci-network.conf')
URIS = ('http://azure.archive.ubuntu.com/ubuntu/',
        'https://archive.ubuntu.com/ubuntu/',
        'https://security.ubuntu.com/ubuntu/')
STOCK = ''.join(f'{uri}\tpriority:{n}\n' for n, uri in enumerate(URIS, 1)).encode()
NETWORK = (b'Acquire::Retries "1";\nAcquire::http::Timeout "15";\n'
           b'Acquire::https::Timeout "15";\nAPT::Update::Error-Mode "any";\n')
BOUNDS = {'Acquire::Retries': '1', 'Acquire::http::Timeout': '15',
          'Acquire::https::Timeout': '15', 'APT::Update::Error-Mode': 'any'}
SECURITY = {'Acquire::AllowInsecureRepositories': 'false', 'Acquire::AllowWeakRepositories': 'false',
            'Acquire::AllowDowngradeToInsecureRepositories': 'false', 'APT::Get::AllowUnauthenticated': 'false',
            'Acquire::https::Verify-Peer': 'true', 'Acquire::https::Verify-Host': 'true',
            'Acquire::Check-Date': 'true', 'Acquire::Check-Valid-Until': 'true'}
LEAVES = tuple(BOUNDS) + tuple(SECURITY)
CONFIG_KEYS = LEAVES + tuple('Binary::apt-get::' + key for key in LEAVES)
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8'}
MAX_FILE = 4 * 1024 * 1024
COMPONENTS = ('main', 'restricted', 'universe', 'multiverse')
KEYRING_PERMISSION_CHAIN = ('/', '/usr', '/usr/share', '/usr/share/keyrings')
PREFLIGHT_DIRECTORIES = ('/etc/apt/sources.list.d', '/etc/apt/trusted.gpg.d', '/etc/apt/keyrings',
                         '/usr/share/keyrings', '/etc/apt/apt.conf.d')


def require(ok, reason):
    if not ok:
        raise RuntimeError(reason)


def admit_platform(system, machine, uid, release, image_os, image_version, actions, runner_environment):
    require(system == 'Linux' and machine == 'x86_64' and uid == 0, 'Hosted root Linux x86_64 required')
    require(release.get('ID') == 'ubuntu' and release.get('VERSION_ID') == '24.04', 'Ubuntu 24.04 required')
    require(image_os == 'ubuntu24' and re.fullmatch(r'[0-9]{8}\.[0-9]+\.[0-9]+', image_version),
            'Actual Ubuntu runner image metadata required')
    require(actions == 'true' and runner_environment == 'github-hosted', 'Hosted GitHub Actions required')


def admit_apt_version(raw):
    require(raw.isascii() and bool(raw.splitlines()), 'Installed APT version text required')
    first = raw.decode('ascii', errors='strict').splitlines()[0]
    match = re.fullmatch(r'apt (2\.8\.[0-9]+(?:[A-Za-z0-9.+~_-]{0,64})) \(amd64\)', first)
    require(match is not None, 'Supported installed Noble APT 2.8 family required')
    return match.group(1)


def mirror_candidate(original):
    # Exact stock bytes, including URI order, keep this deliberately limited to the image mechanism.
    require(original == STOCK, 'Unsupported stock mirror URI, priority or format')
    changed = original.replace(b'priority:1\n', b'priority:3\n', 1)
    changed = changed.replace(b'priority:2\n', b'priority:1\n', 1)
    # The security row is the only remaining original priority:3 row.
    prefix, security = changed.rsplit(b'\n', 2)[0:2]
    require(security == URIS[2].encode() + b'\tpriority:3', 'Unsupported security mirror')
    return prefix + b'\n' + security.replace(b'priority:3', b'priority:2') + b'\n'


def component_diagnostics(tokens):
    return {'componentOrder': [token if token in COMPONENTS else 'unsupported' for token in tokens[:16]],
            'componentCount': len(tokens), 'truncated': len(tokens) > 16}


def config_diagnostics(values):
    # Fixed public keys and typed values only; never expose arbitrary value text or unrelated keys.
    result = {}
    for key in CONFIG_KEYS:
        if key not in values:
            continue
        base = key.removeprefix('Binary::apt-get::')
        value = values[key]
        if base in ('Acquire::Retries', 'Acquire::http::Timeout', 'Acquire::https::Timeout'):
            result[key] = int(value) if re.fullmatch(r'[0-9]{1,6}', value) else 'unsupported'
        elif base == 'APT::Update::Error-Mode':
            result[key] = value if value in ('any', 'persistent') else 'unsupported'
        else:
            result[key] = {'true': True, 'false': False, '1': True, '0': False}.get(value, 'unsupported')
    return result


def admit_sources(raw, observe=None):
    text = raw.decode('utf-8', errors='strict')
    records = []
    for paragraph in re.split(r'\n\s*\n', text.strip()):
        fields = {}
        for line in paragraph.splitlines():
            if not line.strip() or line.lstrip().startswith('#'):
                continue
            require(not line[0].isspace() and ':' in line, 'Unsupported Ubuntu source continuation')
            key, value = line.split(':', 1)
            require(key not in fields, 'Duplicate Ubuntu source field')
            fields[key] = value.strip()
        if fields:
            records.append(fields)
    require(len(records) == 2, 'Two stock Ubuntu source paragraphs required')
    seen = set()
    for ordinal, record in enumerate(records, 1):
        require(set(record) == {'Types', 'URIs', 'Suites', 'Components', 'Signed-By'},
                'Unsupported Ubuntu source or trust override')
        require(record['Types'] == 'deb' and record['URIs'] == 'mirror+file:/etc/apt/apt-mirrors.txt',
                'Stock mirror route required')
        components = record['Components'].split()
        if observe is not None:
            observe({'event': 'COMPONENTS_OBSERVED', 'paragraph': ordinal, **component_diagnostics(components)})
        require(len(components) == 4 and set(components) == set(COMPONENTS),
                'Stock Ubuntu components required')
        require(record['Signed-By'] == '/usr/share/keyrings/ubuntu-archive-keyring.gpg', 'Stock archive key required')
        suites = record['Suites'].split()
        require(len(set(suites)) == len(suites) and not seen.intersection(suites), 'Duplicate Ubuntu suite')
        seen.update(suites)
    require(seen == {'noble', 'noble-updates', 'noble-backports', 'noble-security'}, 'Stock Noble suites required')


def parse_config(raw):
    result = {}
    for line in raw.decode('ascii', errors='strict').splitlines():
        match = re.fullmatch(r'([A-Za-z0-9:_.-]+) "([A-Za-z0-9_-]*)";', line)
        require(match is not None, 'Unsupported limited APT config syntax')
        key, value = match.groups()
        require(key in CONFIG_KEYS and key not in result, 'Unexpected or duplicate limited APT config key')
        result[key] = value
    return result


def admit_config(values, after=False):
    for key, expected in BOUNDS.items():
        actual = values.get(key)
        if key == 'APT::Update::Error-Mode' and not after:
            require(actual in (None, 'persistent', 'any'), 'Unsupported APT update error mode')
        else:
            require(actual == expected, 'Actual stock network bounds differ')
        binary = values.get('Binary::apt-get::' + key)
        require(binary is None or binary == expected, 'Conflicting apt-get binary network override')
    for key, expected in SECURITY.items():
        require(values.get(key) in (None, expected), 'APT authentication or freshness weakened')
        require(values.get('Binary::apt-get::' + key) in (None, expected), 'apt-get authentication override')


def fingerprint(info):
    return {key: getattr(info, 'st_' + key) for key in ('dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size')}


def fixed_directory_diagnostics():
    # Observe every closed public path before the first refusal; never list members or alter permissions.
    result = []
    for literal in PREFLIGHT_DIRECTORIES:
        row = {'path': literal, 'observation': 'unavailable', 'type': 'unknown', 'uid': None,
               'gid': None, 'mode': None, 'canonical': False, 'identityStable': False}
        try:
            before = os.lstat(literal)
        except FileNotFoundError:
            row.update(observation='missing', type='missing')
            result.append(row)
            continue
        except OSError:
            result.append(row)
            continue
        row.update(observation='observed',
                   type='directory' if stat.S_ISDIR(before.st_mode) else
                        'symlink' if stat.S_ISLNK(before.st_mode) else
                        'regular' if stat.S_ISREG(before.st_mode) else 'other',
                   mode=oct(stat.S_IMODE(before.st_mode)))
        for name in ('uid', 'gid'):
            value = getattr(before, 'st_' + name)
            row[name] = value if type(value) is int and 0 <= value <= 4294967295 else None
        try:
            row['canonical'] = Path(literal).resolve(strict=True) == Path(literal)
        except (OSError, RuntimeError):
            pass
        try:
            row['identityStable'] = fingerprint(os.lstat(literal)) == fingerprint(before)
        except OSError:
            pass
        result.append(row)
    return result


def safe_read(path, uid=0):
    path = Path(path)
    require(path.is_absolute() and path.resolve(strict=True) == path, 'Canonical input path required')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == uid and before.st_nlink == 1
                and before.st_mode & 0o022 == 0 and before.st_size <= MAX_FILE, 'Safe original regular file required')
        require(fingerprint(os.lstat(path)) == fingerprint(before), 'Original named FD differs')
        raw = bytearray()
        while True:
            part = os.read(fd, 65536)
            if not part:
                break
            raw.extend(part)
            require(len(raw) <= MAX_FILE, 'Original exceeds bound')
        require(fingerprint(os.fstat(fd)) == fingerprint(before)
                and fingerprint(os.lstat(path)) == fingerprint(before) and len(raw) == before.st_size,
                'Original changed during read')
        return bytes(raw), fingerprint(before)
    finally:
        os.close(fd)


def input_namespace():
    paths = [SOURCES, Path('/usr/share/keyrings/ubuntu-archive-keyring.gpg')]
    for file in (Path('/etc/apt/sources.list'), Path('/etc/apt/trusted.gpg')):
        if file.exists() or file.is_symlink():
            paths.append(file)
    for directory in ('/etc/apt/sources.list.d', '/etc/apt/trusted.gpg.d', '/etc/apt/keyrings', '/usr/share/keyrings'):
        root = Path(directory)
        if not root.exists():
            continue
        require(root.resolve(strict=True) == root, 'Canonical source/trust directory required')
        info = root.stat()
        require(info.st_uid == 0 and info.st_mode & 0o022 == 0, 'Root-owned source/trust directory required')
        members = sorted(root.iterdir())
        require(len(members) <= 128, 'Source/trust namespace exceeds bound')
        paths.extend(members)
    return sorted(set(paths))


def source_snapshot():
    result = []
    for path in input_namespace():
        raw, identity = safe_read(path)
        result.append({'path': str(path), 'sha256': hashlib.sha256(raw).hexdigest(), **identity})
    return result


def write_owned(path, raw):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        require(os.fstat(fd).st_uid == 0 and os.fstat(fd).st_gid == 0
                and os.fstat(fd).st_nlink == 1, 'Owned output FD required')
        with os.fdopen(os.dup(fd), 'wb') as output:
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
    finally:
        os.close(fd)
    saved, _ = safe_read(path)
    require(saved == raw, 'Original output readback differs')


def replace_original(path, original, identity, candidate, uid=0):
    current, info = safe_read(path, uid)
    require(current == original and info == identity, 'Original mirror drift before mutation')
    fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
    try:
        require(fingerprint(os.fstat(fd)) == identity and fingerprint(os.lstat(path)) == identity,
                'Original writable mirror FD differs')
        require(os.read(fd, len(original) + 1) == original, 'Original mirror FD bytes differ')
        os.lseek(fd, 0, os.SEEK_SET)
        require(os.write(fd, candidate) == len(candidate), 'Partial mirror write')
        os.ftruncate(fd, len(candidate))
        os.fsync(fd)
        require(os.fstat(fd).st_ino == identity['ino'] and os.fstat(fd).st_dev == identity['dev'],
                'Original mirror identity changed')
    finally:
        os.close(fd)
    saved, info = safe_read(path, uid)
    require(saved == candidate and info['ino'] == identity['ino'] and info['dev'] == identity['dev'],
            'Mirror readback differs')


def harden_original_keyring_permissions(output, observe=None):
    """Tighten only observed image777 modes; retain original byte custody, not authenticity."""
    descriptors = []
    directories = []
    files = []
    def named_matches(item):
        return fingerprint(os.lstat(item['path'])) == fingerprint(os.fstat(item['fd']))
    def read_original(item):
        os.lseek(item['fd'], 0, os.SEEK_SET)
        data = bytearray()
        while True:
            part = os.read(item['fd'], 65536)
            if not part:
                break
            data.extend(part)
            require(len(data) <= MAX_FILE, 'Original public key exceeds bound')
        return bytes(data)
    try:
        parent = None
        for ordinal, literal in enumerate(KEYRING_PERMISSION_CHAIN):
            path = Path(literal)
            try:
                canonical = path.resolve(strict=True) == path
            except (OSError, RuntimeError):
                canonical = False
            require(canonical, 'Canonical stock keyring permission path required')
            name = literal if ordinal == 0 else path.name
            fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            descriptors.append(fd)
            info = os.fstat(fd)
            mode = stat.S_IMODE(info.st_mode)
            if observe is not None:
                observe({'event': 'KEYRING_CHAIN_METADATA', 'path': literal, 'uid': info.st_uid,
                         'gid': info.st_gid, 'mode': oct(mode), 'originalNamedFd':
                         fingerprint(os.lstat(path)) == fingerprint(info)})
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and
                    (mode & 0o022 == 0 or ordinal >= 2 and mode == 0o777),
                    'Root-owned admitted keyring directory required')
            item = {'path': literal, 'fd': fd, 'before': fingerprint(info),
                    'targetMode': 0o755 if mode == 0o777 else mode}
            require(named_matches(item), 'Original keyring directory FD differs')
            directories.append(item)
            parent = fd
        members = sorted(os.listdir(parent))
        require(0 < len(members) <= 128, 'Original public key namespace exceeds bound')
        for ordinal, name in enumerate(members, 1):
            require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._+-]{0,127}\.(gpg|asc)', name) is not None,
                    'Unsupported original public key member')
            path = Path(KEYRING_PERMISSION_CHAIN[-1]) / name
            named_before = os.stat(name, dir_fd=parent, follow_symlinks=False)
            named_mode = stat.S_IMODE(named_before.st_mode)
            require(stat.S_ISREG(named_before.st_mode) and named_before.st_uid == 0
                    and named_before.st_nlink == 1 and named_before.st_size <= MAX_FILE
                    and (named_mode & 0o022 == 0 or named_mode == 0o777),
                    'Root-owned admitted original public key required')
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
            descriptors.append(fd)
            info = os.fstat(fd)
            require(fingerprint(info) == fingerprint(named_before), 'Original public key pre-open drift')
            mode = stat.S_IMODE(info.st_mode)
            require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
                    and info.st_size <= MAX_FILE and (mode & 0o022 == 0 or mode == 0o777),
                    'Root-owned admitted original public key required')
            item = {'path': str(path), 'fd': fd, 'before': fingerprint(info),
                    'targetMode': 0o644 if mode == 0o777 else mode, 'ordinal': ordinal}
            require(named_matches(item), 'Original public key named FD differs')
            item['bytes'] = read_original(item)
            require(len(item['bytes']) == info.st_size and named_matches(item)
                    and fingerprint(os.fstat(fd)) == item['before'], 'Original public key changed')
            files.append(item)
        require('ubuntu-archive-keyring.gpg' in members, 'Original stock archive key required')
        all_items = directories + files
        require(sorted(os.listdir(parent)) == members and all(named_matches(item)
                and fingerprint(os.fstat(item['fd'])) == item['before'] for item in all_items),
                'Original keyring namespace drift before hardening')
        # Preserve all original public key bytes and metadata before the first permission write.
        for item in files:
            write_owned(output / f"public-key-{item['ordinal']:03}.original", item['bytes'])
        plan = [{'path': item['path'], 'before': item['before'], 'targetMode': oct(item['targetMode']),
                 **({'sha256': hashlib.sha256(item['bytes']).hexdigest()} if 'bytes' in item else {})}
                for item in all_items]
        write_owned(output / 'keyring-permissions.original.json',
                    (json.dumps(plan, sort_keys=True) + '\n').encode())
        require(sorted(os.listdir(parent)) == members and all(named_matches(item)
                and fingerprint(os.fstat(item['fd'])) == item['before'] for item in all_items)
                and all(read_original(item) == item['bytes'] for item in files),
                'Original keyring drift after custody before hardening')
        changed = 0
        expected_after = []
        for item in all_items:
            require(named_matches(item) and fingerprint(os.fstat(item['fd'])) == item['before'],
                    'Original keyring FD drift before its permission write')
            expected = dict(item['before'])
            if stat.S_IMODE(expected['mode']) != item['targetMode']:
                os.fchmod(item['fd'], item['targetMode'])
                changed += 1
                expected['mode'] = stat.S_IFMT(expected['mode']) | item['targetMode']
            require(fingerprint(os.fstat(item['fd'])) == expected and named_matches(item),
                    'Original keyring identity drift during hardening')
            expected_after.append(expected)
        require(sorted(os.listdir(parent)) == members and all(named_matches(item)
                and fingerprint(os.fstat(item['fd'])) == expected
                for item, expected in zip(all_items, expected_after))
                and all(read_original(item) == item['bytes'] for item in files),
                'Original public key bytes/namespace changed during hardening')
        result = {'decision': 'PERMISSIONS_HARDENED', 'changedOriginalModes': changed,
                  'existingPublicKeyFiles': len(files), 'contentUnchanged': True,
                  'originalContentAuthenticity': 'NOT_ESTABLISHED_BY_PERMISSION_REPAIR',
                  'directoryModesBefore': [{'path': item['path'], 'mode': oct(stat.S_IMODE(item['before']['mode']))}
                                           for item in directories]}
    finally:
        for fd in reversed(descriptors):
            os.close(fd)
    # Every original handle is closed. Reopen and compare the admitted post-mode vector before success.
    result['admittedKeyringInputs'] = reopen_hardened_keyrings(directories, files, members, expected_after)
    write_owned(output / 'keyring-permissions.result.json',
                (json.dumps(result, sort_keys=True) + '\n').encode())
    return result


def reopen_hardened_keyrings(directories, files, members, expected_after):
    descriptors = []
    try:
        parent = None
        for ordinal, (item, expected) in enumerate(zip(directories, expected_after[:4])):
            path = Path(KEYRING_PERMISSION_CHAIN[ordinal])
            try:
                canonical = path.resolve(strict=True) == path
            except (OSError, RuntimeError):
                canonical = False
            require(canonical and str(path) == item['path'], 'Canonical reopened keyring chain required')
            fd = os.open(str(path) if ordinal == 0 else path.name,
                         os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            descriptors.append(fd)
            info = os.fstat(fd)
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and info.st_mode & 0o022 == 0
                    and fingerprint(info) == expected
                    and fingerprint(os.lstat(path)) == expected, 'Reopened original keyring directory differs')
            parent = fd
        require(sorted(os.listdir(parent)) == members, 'Reopened original public key namespace differs')
        result = []
        for item, expected in zip(files, expected_after[4:]):
            path = Path(item['path'])
            named = os.stat(path.name, dir_fd=parent, follow_symlinks=False)
            require(stat.S_ISREG(named.st_mode) and named.st_uid == 0 and named.st_nlink == 1
                    and named.st_mode & 0o022 == 0 and named.st_size <= MAX_FILE
                    and fingerprint(named) == expected, 'Reopened original public key metadata differs')
            fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
            descriptors.append(fd)
            require(fingerprint(os.fstat(fd)) == expected, 'Reopened original public key FD differs')
            data = bytearray()
            while True:
                part = os.read(fd, 65536)
                if not part: break
                data.extend(part)
                require(len(data) <= MAX_FILE, 'Reopened original public key exceeds bound')
            require(bytes(data) == item['bytes'] and fingerprint(os.fstat(fd)) == expected
                    and fingerprint(os.lstat(path)) == expected, 'Reopened original public key bytes/identity differ')
            result.append({'path': item['path'], 'sha256': hashlib.sha256(data).hexdigest(), **expected})
        require(sorted(os.listdir(parent)) == members, 'Reopened keyring namespace changed during verification')
        for item, expected, fd in zip(directories, expected_after[:4], descriptors[:4]):
            require(fingerprint(os.fstat(fd)) == expected and fingerprint(os.lstat(item['path'])) == expected,
                    'Reopened keyring chain changed during verification')
        return sorted(result, key=lambda item: item['path'])
    finally:
        for fd in reversed(descriptors): os.close(fd)


def limited_config(observe=None):
    # apt-config 2.8.3 DoDump accepts named subtrees. Never dump unrelated proxy/auth configuration.
    argv = ['/usr/bin/apt-config', 'dump', *CONFIG_KEYS]
    result = subprocess.run(argv, env=ENV, capture_output=True, timeout=10, check=False)
    require(result.returncode == 0 and len(result.stdout) <= 32768 and not result.stderr,
            'Limited original APT config command failed')
    values = parse_config(result.stdout)
    if observe is not None:
        observe({'event': 'LIMITED_APT_CONFIG_OBSERVED', 'typedValues': config_diagnostics(values)})
    admit_config(values)
    return result.stdout, values


def main(argv):
    require(len(argv) == 4, 'Only explicit public runner image/environment arguments are accepted')
    release = {}
    for line in Path('/etc/os-release').read_text().splitlines():
        if '=' in line:
            key, value = line.split('=', 1)
            release[key] = value.strip('"')
    admit_platform(platform.system(), platform.machine(), os.getuid(), release, *argv)
    version_result = subprocess.run(['/usr/bin/apt-get', '--version'], env=ENV, capture_output=True, timeout=10, check=False)
    require(version_result.returncode == 0 and 0 < len(version_result.stdout) <= 16384
            and not version_result.stderr, 'Installed APT version observation failed')
    apt_version = admit_apt_version(version_result.stdout)
    observe = lambda item: print(json.dumps(item, sort_keys=True), flush=True)
    observe({'event': 'APT_VERSION_OBSERVED', 'installedAptVersion': apt_version})
    observe({'event': 'PUBLIC_APT_DIRECTORY_METADATA', 'directories': fixed_directory_diagnostics()})
    original, mirror_identity = safe_read(MIRROR)
    candidate = mirror_candidate(original)
    source, _ = safe_read(SOURCES)
    admit_sources(source, observe)
    config_raw, config = limited_config(observe)
    require(not STRICT.exists() and not STRICT.is_symlink(), 'Strict config already exists')
    require(not Path('/etc/apt/apt.conf').exists() and not Path('/etc/apt/apt.conf').is_symlink(),
            'Unsupported main APT config override')
    config_dir = STRICT.parent
    require(config_dir.resolve(strict=True) == config_dir and config_dir.stat().st_uid == 0
            and config_dir.stat().st_mode & 0o022 == 0, 'Root-owned config directory required')
    require(all(item.name < STRICT.name for item in config_dir.iterdir()),
            'Strict config must be the last original fragment')
    # Source/mirror/config admission precedes bounded permission repair; strict census then precedes APT mutation.
    output = Path(tempfile.mkdtemp(prefix='inherit-ci-apt-', dir='/var/tmp'))
    os.chmod(output, 0o700)
    write_owned(output / 'mirror.original', original)
    write_owned(output / 'limited-config.original', config_raw)
    write_owned(output / 'apt-version.original', version_result.stdout)
    hardening = harden_original_keyring_permissions(output, observe)
    observe({key: value for key, value in hardening.items() if key != 'admittedKeyringInputs'})
    before = source_snapshot()
    key_prefix = KEYRING_PERMISSION_CHAIN[-1] + '/'
    require([item for item in before if item['path'].startswith(key_prefix)] == hardening['admittedKeyringInputs'],
            'Strict keyring census differs from admitted post-close original vector')
    admission = {'decision': 'ADMITTED', 'imageOS': argv[0], 'imageVersion': argv[1],
                 'runnerEnvironment': argv[3], 'installedAptVersion': apt_version,
                 'aptVersionOriginalSha256': hashlib.sha256(version_result.stdout).hexdigest(),
                 'mirrorOriginal': original.decode('ascii'), 'mirrorIdentity': mirror_identity,
                 'limitedConfig': config, 'sourceAndTrust': before, 'originalDirectory': str(output)}
    write_owned(output / 'admission.json', (json.dumps(admission, sort_keys=True) + '\n').encode())
    print(json.dumps(admission, sort_keys=True), flush=True)
    write_owned(STRICT, NETWORK)
    os.chmod(STRICT, 0o644)
    strict_raw, strict_identity = safe_read(STRICT)
    require(strict_raw == NETWORK, 'Strict config custody differs')
    replace_original(MIRROR, original, mirror_identity, candidate)
    after_raw, after_config = limited_config(observe)
    admit_config(after_config, after=True)
    write_owned(output / 'limited-config.after', after_raw)
    require(source_snapshot() == before, 'Source/key/trust drift before signed update')
    # any rejects transient failures; installed Playwright's later update inherits the same root setting.
    command = ['/usr/bin/apt-get', 'update', '--error-on=any']
    with open(output / 'signed-update.original.log', 'xb', buffering=0) as log:
        os.chmod(log.name, 0o600)
        process = subprocess.Popen(command, env=ENV, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        for part in iter(lambda: os.read(process.stdout.fileno(), 65536), b''):
            log.write(part)
            sys.stdout.buffer.write(part)
            sys.stdout.buffer.flush()
        status = process.wait()
        os.fsync(log.fileno())
    outcome = {'argv': command, 'exitCode': status, 'originalDirectory': str(output)}
    write_owned(output / 'signed-update-result.json', (json.dumps(outcome, sort_keys=True) + '\n').encode())
    print(json.dumps(outcome, sort_keys=True), flush=True)
    require(status == 0, 'Fresh signed metadata update failed')
    require(source_snapshot() == before, 'Source/key/trust drift after signed update')
    require(safe_read(MIRROR)[0] == candidate and safe_read(STRICT) == (strict_raw, strict_identity),
            'Mirror/config drift after signed update')
    _, final_config = limited_config(observe)
    admit_config(final_config, after=True)
    print(json.dumps({'decision': 'PASS', 'freshSignedMetadata': True,
                      'fullPlaywrightInstallStillRequired': True, 'originalDirectory': str(output)}), flush=True)


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        # Fixed labels only; no unrelated APT configuration or exception values are disclosed.
        print(json.dumps({'decision': 'HOLD', 'errorType': type(error).__name__,
                          'reason': str(error) if isinstance(error, RuntimeError) else 'Original operation failed'}),
              file=sys.stderr, flush=True)
        raise SystemExit(1)

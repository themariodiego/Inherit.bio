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
    match = re.fullmatch(r'apt (2\.8\.[0-9]+(?:[A-Za-z0-9.+~_-]*)) \(amd64\)', first)
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


def admit_sources(raw):
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
    for record in records:
        require(set(record) == {'Types', 'URIs', 'Suites', 'Components', 'Signed-By'},
                'Unsupported Ubuntu source or trust override')
        require(record['Types'] == 'deb' and record['URIs'] == 'mirror+file:/etc/apt/apt-mirrors.txt',
                'Stock mirror route required')
        require(record['Components'].split() == ['main', 'restricted', 'universe', 'multiverse'],
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


def limited_config():
    # apt-config 2.8.3 DoDump accepts named subtrees. Never dump unrelated proxy/auth configuration.
    argv = ['/usr/bin/apt-config', 'dump', *CONFIG_KEYS]
    result = subprocess.run(argv, env=ENV, capture_output=True, timeout=10, check=False)
    require(result.returncode == 0 and len(result.stdout) <= 32768 and not result.stderr,
            'Limited original APT config command failed')
    values = parse_config(result.stdout)
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
    original, mirror_identity = safe_read(MIRROR)
    candidate = mirror_candidate(original)
    source, _ = safe_read(SOURCES)
    admit_sources(source)
    before = source_snapshot()
    config_raw, config = limited_config()
    require(not STRICT.exists() and not STRICT.is_symlink(), 'Strict config already exists')
    require(not Path('/etc/apt/apt.conf').exists() and not Path('/etc/apt/apt.conf').is_symlink(),
            'Unsupported main APT config override')
    config_dir = STRICT.parent
    require(config_dir.resolve(strict=True) == config_dir and config_dir.stat().st_uid == 0
            and config_dir.stat().st_mode & 0o022 == 0, 'Root-owned config directory required')
    require(all(item.name < STRICT.name for item in config_dir.iterdir()),
            'Strict config must be the last original fragment')
    # Every admission above precedes mutation. Preserve originals on this disposable root-owned runner.
    output = Path(tempfile.mkdtemp(prefix='inherit-ci-apt-', dir='/var/tmp'))
    os.chmod(output, 0o700)
    write_owned(output / 'mirror.original', original)
    write_owned(output / 'limited-config.original', config_raw)
    write_owned(output / 'apt-version.original', version_result.stdout)
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
    after_raw, after_config = limited_config()
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
    _, final_config = limited_config()
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

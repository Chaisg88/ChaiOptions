"""Create the free Render web service. Never logs keys or bootstrap passwords."""
import argparse
import json
import os
from pathlib import Path
import secrets
import urllib.request
import urllib.error

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--owner-id', required=True)
parser.add_argument('--root-email', required=True)
parser.add_argument('--credentials-dir', required=True)
parser.add_argument('--dry-run', action='store_true')
args = parser.parse_args()
if not args.owner_id.startswith(('tea-', 'usr-')):
    raise SystemExit('Supply the actual Render workspace/owner ID.')
if not args.dry_run and not os.environ.get('RENDER_API_KEY'):
    raise SystemExit('RENDER_API_KEY is unavailable.')
folder = Path(args.credentials_dir).resolve()
# Credentials must be retained outside the public web directory and source checkout.
checkout = Path(__file__).resolve().parent.parent
if folder == checkout or checkout in folder.parents:
    raise SystemExit('Choose a credentials directory outside the source checkout.')
folder.mkdir(mode=0o700, parents=True, exist_ok=True)
credential_file = folder / 'production-credentials.local.json'
if args.dry_run:
    password = '[GENERATED AT DEPLOYMENT]'
elif credential_file.exists():
    saved = json.loads(credential_file.read_text())
    if saved['email'] != args.root_email:
        raise SystemExit('Existing bootstrap credentials use a different email.')
    password = saved['password']
else:
    password = secrets.token_urlsafe(24)
    fd = os.open(credential_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as file:
        json.dump({'email': args.root_email, 'password': password}, file)
body = {
    'type': 'web_service', 'name': 'chai-options', 'ownerId': args.owner_id,
    'repo': 'https://github.com/Chaisg88/ChaiOptions', 'branch': 'main',
    'autoDeployTrigger': 'commit',
    'envVars': [{'key': k, 'value': v} for k, v in {
        'NODE_VERSION': '24.19.0', 'NODE_ENV': 'production',
        'REQUIRE_DATABASE': 'true', 'ROOT_EMAIL': args.root_email,
        'ROOT_PASSWORD': password,
    }.items()],
    'serviceDetails': {
        'runtime': 'node', 'plan': 'free', 'region': 'singapore',
        'numInstances': 1, 'healthCheckPath': '/health',
        'envSpecificDetails': {'buildCommand': 'npm ci && npm test', 'startCommand': 'npm start'},
    },
}
if args.dry_run:
    print(json.dumps(body, indent=2))
    raise SystemExit()
key = os.environ['RENDER_API_KEY']

def api(endpoint, payload=None):
    request = urllib.request.Request(
        'https://api.render.com/v1' + endpoint,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={'Authorization': 'Bearer ' + key, 'Accept': 'application/json', 'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        content = error.read(2000).decode(errors='replace').replace(key, '[REDACTED]').replace(password, '[REDACTED]')
        try:
            message = json.loads(content).get('message', 'Request failed')
        except ValueError:
            message = 'Non-JSON response; check access and provider status.'
        raise SystemExit(f'Render API HTTP {error.code}: {message}')

services = api('/services?limit=100')
existing = [x['service'] for x in services if x.get('service', {}).get('name') == 'chai-options' and x['service'].get('ownerId') == args.owner_id]
if existing:
    service = existing[0]
    result = {'deployId': None}
else:
    result = api('/services', body)
    service = result.get('service', {})
metadata = {'service_id': service.get('id'), 'deploy_id': result.get('deployId'), 'url': service.get('serviceDetails', {}).get('url'), 'dashboard_url': service.get('dashboardUrl'), 'already_exists': bool(existing)}
(folder / 'render-deployment.json').write_text(json.dumps(metadata, indent=2))
if not existing:
    fd = os.open(folder / 'production-credentials.local.md', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as file:
        file.write('# Production sign-in\n\nEmail: ' + args.root_email + '\n\nTemporary password: `' + password + '`\n\nChange this password at first sign-in.\n')
print(json.dumps(metadata))

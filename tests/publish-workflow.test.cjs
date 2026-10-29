const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const YAML = require('yaml');

const root = path.join(__dirname, '..');
const workflow = YAML.parse(fs.readFileSync(
  path.join(root, '.github', 'workflows', 'publish.yml'), 'utf8'
));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const guardStep = workflow.jobs.build.steps.find((step) => step.id === 'version');
const guard = guardStep.run.split("node <<'NODE'\n")[1]?.split('\nNODE')[0];

function validateRelease(env, packageOverrides = {}) {
  const writes = [];
  assert.ok(guard, 'The workflow must include its release validation script');
  vm.runInNewContext(guard, {
    process: { env: { GITHUB_OUTPUT: 'output', ...env } },
    require: (name) => {
      if (name === 'node:fs') {
        return { appendFileSync: (file, value) => writes.push({ file, value }) };
      }
      if (name === './package.json') return { ...manifest, ...packageOverrides };
      throw new Error(`Unexpected release guard dependency: ${name}`);
    },
  });
  return writes;
}

test('publishing uses the validated artifact and limits OIDC permission to the publish job', () => {
  assert.deepEqual(workflow.on.push.tags, ['v*']);
  assert.ok(Object.hasOwn(workflow.on, 'workflow_dispatch'));
  assert.equal(workflow.permissions.contents, 'read');
  assert.equal(workflow.permissions['id-token'], undefined);
  assert.equal(workflow.jobs.build.permissions?.['id-token'], undefined);
  assert.equal(workflow.jobs.publish.permissions['id-token'], 'write');
  assert.equal(workflow.jobs.publish.needs, 'build');
  assert.ok(workflow.jobs.build.steps.some((step) =>
    step.run === 'npm run package -- --out extension.vsix'
  ));
  assert.ok(workflow.jobs.publish.steps.some((step) =>
    step.run === 'npx --no-install vsce publish --oidc --packagePath release/extension.vsix'
  ));
});

test('release validation accepts a matching version tag and a manual run from main', () => {
  for (const env of [
    { GITHUB_EVENT_NAME: 'push', GITHUB_REF: `refs/tags/v${manifest.version}` },
    { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main' },
  ]) {
    assert.deepEqual(validateRelease(env), [
      { file: 'output', value: `version=${manifest.version}\n` },
    ]);
  }
});

test('release validation rejects mismatched tags and manual runs from other refs', () => {
  assert.throws(() => validateRelease({
    GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/tags/v0.0.0',
  }), /tag must match/i);
  assert.throws(() => validateRelease({
    GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/feature',
  }), /must run from main/i);
});

test('release validation rejects unexpected extension identities and unstable versions', () => {
  const env = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main' };
  assert.throws(() => validateRelease(env, { publisher: 'unexpected' }), /extension identity/i);
  assert.throws(() => validateRelease(env, { name: 'unexpected' }), /extension identity/i);
  for (const version of [
    '01.1.0', '1.1', '1.1.0-preview', '1.1.0\n', '1.1.0\ninjected=value', 1,
  ]) {
    assert.throws(() => validateRelease(env, { version }), /stable major.minor.patch/i);
  }
});

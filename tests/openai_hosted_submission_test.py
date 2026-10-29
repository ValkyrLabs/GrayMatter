#!/usr/bin/env python3
"""Independent checks for the bounded hosted package, without production access."""
from pathlib import Path
import copy
import importlib.util
import json
import sys
import tempfile
import unittest
import zipfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('hosted_builder', ROOT / 'scripts' / 'package-openai-submission.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

class HostedPackageTest(unittest.TestCase):
    def setUp(self):
        self.manifest, self.files = builder.load()
        self.mcp = json.loads(self.files['.mcp.json'])

    def test_exact_public_scope_and_prompts(self):
        self.assertEqual(len(self.files), 9)
        guide = (ROOT / 'docs' / 'reviewer-test-credentials.md').read_text()
        cases = self.manifest['extensions']['com.openai']['review']['test_cases']
        self.assertEqual((len(cases['positive']), len(cases['negative'])), (5, 3))
        for case in cases['positive'] + cases['negative']:
            self.assertIn('`' + case['prompt'] + '`', guide)
        self.assertEqual(self.mcp['mcpServers']['graymatter'], {'url': builder.ENDPOINT})
        self.assertNotIn('apps', self.manifest)
        self.assertNotIn('screenshots', self.manifest['interface'])

    def test_invalid_scope_and_credentials_are_rejected(self):
        invalid = copy.deepcopy(self.manifest)
        invalid['name'] = 'graymatter'
        with self.assertRaisesRegex(ValueError, 'existing plugin package name'):
            builder.validate(invalid, self.mcp, self.files)
        invalid = copy.deepcopy(self.manifest)
        invalid['apps'] = './.app.json'
        with self.assertRaisesRegex(ValueError, 'App references'):
            builder.validate(invalid, self.mcp, self.files)
        invalid = copy.deepcopy(self.manifest)
        invalid['extensions']['com.openai']['review']['test_credentials'] = 'synthetic-invalid-field'
        with self.assertRaisesRegex(ValueError, 'secure portal'):
            builder.validate(invalid, self.mcp, self.files)
        local = {'mcpServers': {'graymatter': {'command': 'node', 'args': ['index.js']}}}
        with self.assertRaisesRegex(ValueError, 'production HTTPS'):
            builder.validate(self.manifest, local, self.files)

    def test_first_use_skills_and_starters_ship_together(self):
        self.assertEqual(set(builder.SKILLS), {
            'graymatter-onboarding', 'graymatter-memory', 'graymatter-context'})
        prompts = self.manifest['interface']['defaultPrompt']
        self.assertTrue(any('first useful memory' in p for p in prompts))
        self.assertTrue(any('primary memory' in p for p in prompts))
        self.assertFalse(any('seeded' in p or 'release review' in p for p in prompts))
        for skill in builder.SKILLS:
            relative = f'skills/{skill}/SKILL.md'
            self.assertEqual(self.files[relative], (ROOT / relative).read_bytes())
            self.assertEqual(self.files[relative],
                             (ROOT / 'plugins' / 'graymatter' / relative).read_bytes())

    def test_listing_limits_and_component_omissions_fail(self):
        invalid = copy.deepcopy(self.manifest)
        invalid['interface']['shortDescription'] = 'x' * 31
        with self.assertRaisesRegex(ValueError, 'listing limit'):
            builder.validate(invalid, self.mcp, self.files)
        missing = dict(self.files)
        missing.pop('skills/graymatter-context/SKILL.md')
        with self.assertRaisesRegex(ValueError, 'two manifests'):
            builder.validate(self.manifest, self.mcp, missing)

    def test_deterministic_archive_matches_canonical_bytes(self):
        with tempfile.TemporaryDirectory(prefix='graymatter-hosted-test-') as temporary:
            a, b = Path(temporary) / 'a.zip', Path(temporary) / 'b.zip'
            result = builder.build(a)
            builder.build(b)
            self.assertEqual(a.read_bytes(), b.read_bytes())
            self.assertLess(result['bytes'], 100_000)
            with zipfile.ZipFile(a) as archive:
                self.assertEqual(set(archive.namelist()), set(self.files))
                for name, content in self.files.items():
                    self.assertEqual(archive.read(name), content)
            self.assertFalse(result['portalUploaded'])
            self.assertFalse(result['productionDeployed'])

if __name__ == '__main__':
    unittest.main()

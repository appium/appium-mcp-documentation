import appiumConfig, {defineConfig, ignorePatterns} from '@appium/oxc-config/oxlint';

export default defineConfig({
  ...appiumConfig,
  ignorePatterns: [...ignorePatterns, 'dist/', 'src/resources/submodules'],
  rules: {
    'no-console': 'off',
  },
});

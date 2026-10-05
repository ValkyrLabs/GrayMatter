ObjC.import('Cocoa');
ObjC.import('stdlib');

function thorEnvironmentValue(thorName) {
  const thorValue = $.NSProcessInfo.processInfo.environment.objectForKey(thorName);
  return (thorValue ? ObjC.unwrap(thorValue) : '') || '';
}

function thorLabel(thorText, thorFrame) {
  const thorControl = $.NSTextField.labelWithString(thorText);
  thorControl.frame = thorFrame;
  return thorControl;
}

function thorInstanceUrl(thorBase) {
  try {
    const thorUrl = $.NSURL.URLWithString(thorBase.replace(/\/v1\/?$/, ''));
    const thorScheme = ObjC.unwrap(thorUrl.scheme);
    if (!['http', 'https'].includes(thorScheme) || !ObjC.unwrap(thorUrl.host)
      || ObjC.unwrap(thorUrl.user) || ObjC.unwrap(thorUrl.password)
      || ObjC.unwrap(thorUrl.query) || ObjC.unwrap(thorUrl.fragment)) return null;
    return thorUrl;
  } catch { return null; }
}

let thorSelectionChanged;
ObjC.registerSubclass({
  name: 'GrayMatterConnectionPicker',
  superclass: 'NSObject',
  methods: {
    'connectionChanged:': {
      types: ['void', ['id']],
      implementation: function (sender) { thorSelectionChanged(sender); }
    }
  }
});

function run() {
  const thorSignupUrl = thorEnvironmentValue('GRAYMATTER_SIGNUP_URL');
  const thorRecoveryUrl = thorEnvironmentValue('GRAYMATTER_RECOVERY_URL');
  const thorChoices = JSON.parse(thorEnvironmentValue('GRAYMATTER_CONNECTION_CHOICES'));
  const thorCloudBase = thorChoices[0].apiBase;
  const thorErrorMessage = thorEnvironmentValue('GRAYMATTER_AUTH_ERROR');
  const thorHost = Application.currentApplication();
  thorHost.includeStandardAdditions = true;
  const thorApplication = $.NSApplication.sharedApplication;
  thorApplication.setActivationPolicy($.NSApplicationActivationPolicyRegular);
  let thorRememberedUsername = thorEnvironmentValue('GRAYMATTER_DEFAULT_USERNAME');
  let thorRememberedBase = thorEnvironmentValue('GRAYMATTER_DEFAULT_API_BASE') || thorCloudBase;
  let thorRememberedKind = thorEnvironmentValue('GRAYMATTER_DEFAULT_CONNECTION_KIND') || 'hosted';
  let thorGuidance = thorErrorMessage || 'Choose Cloud or your local / self-hosted instance, then sign in.';
  let thorGuidanceIsError = Boolean(thorErrorMessage);
  let thorOpenedBrowser = false;
  const thorDelegate = $.GrayMatterConnectionPicker.alloc.init;

  while (true) {
    const thorAlert = $.NSAlert.alloc.init;
    thorAlert.messageText = 'Connect to GrayMatter';
    thorAlert.informativeText = thorGuidance;
    thorAlert.alertStyle = thorGuidanceIsError ? $.NSAlertStyleCritical : $.NSAlertStyleInformational;
    thorAlert.addButtonWithTitle('Sign In');
    thorAlert.addButtonWithTitle('Create Free Account');
    thorAlert.addButtonWithTitle('Recover Account');
    thorAlert.addButtonWithTitle('Cancel');

    const thorView = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, 480, 294));
    const thorPicker = $.NSPopUpButton.alloc.initWithFramePullsDown($.NSMakeRect(0, 250, 480, 28), false);
    thorChoices.forEach(function (choice) { thorPicker.addItemWithTitle(choice.label); });
    let thorIndex = thorChoices.findIndex(function (choice) { return choice.apiBase === thorRememberedBase && choice.kind === thorRememberedKind; });
    if (thorIndex < 0) thorIndex = 3;
    thorPicker.selectItemAtIndex(thorIndex);
    thorPicker.target = thorDelegate;
    thorPicker.action = 'connectionChanged:';
    const thorServer = $.NSTextField.alloc.initWithFrame($.NSMakeRect(0, 194, 480, 26));
    thorServer.stringValue = thorRememberedBase;
    thorServer.placeholderString = 'https://your-server.example/v1';
    const thorKind = $.NSPopUpButton.alloc.initWithFramePullsDown($.NSMakeRect(0, 145, 480, 26), false);
    thorKind.addItemWithTitle('ValkyrAI account');
    thorKind.addItemWithTitle('GrayMatter Lite local account');
    thorKind.selectItemAtIndex(thorRememberedKind === 'local' ? 1 : 0);
    const thorKindLabel = thorLabel('Self-hosted instance type', $.NSMakeRect(0, 172, 480, 18));
    thorKind.hidden = thorIndex !== 3;
    thorKindLabel.hidden = thorIndex !== 3;
    const thorHint = thorLabel('Self-hosted? Use your instance account. Cloud signup is optional.', $.NSMakeRect(0, 116, 480, 22));
    thorHint.font = $.NSFont.systemFontOfSize(11);
    const thorUsername = $.NSTextField.alloc.initWithFrame($.NSMakeRect(0, 56, 480, 26));
    thorUsername.placeholderString = 'username';
    thorUsername.stringValue = thorRememberedUsername;
    const thorPassword = $.NSSecureTextField.alloc.initWithFrame($.NSMakeRect(0, 2, 480, 26));
    thorPassword.placeholderString = 'Password for the selected instance';
    [
      thorLabel('Connection', $.NSMakeRect(0, 278, 480, 18)), thorPicker,
      thorLabel('Server URL', $.NSMakeRect(0, 222, 480, 18)), thorServer,
      thorKindLabel, thorKind, thorHint,
      thorLabel('Username', $.NSMakeRect(0, 84, 480, 18)), thorUsername,
      thorLabel('Password', $.NSMakeRect(0, 30, 480, 18)), thorPassword
    ].forEach(function (control) { thorView.addSubview(control); });
    function thorUpdateButtons() {
      const cloud = ObjC.unwrap(thorServer.stringValue).replace(/\/+$/, '') === thorCloudBase;
      thorAlert.buttons.objectAtIndex(1).title = cloud ? 'Create Free Account' : 'Open Instance';
      thorAlert.buttons.objectAtIndex(2).title = cloud ? 'Recover Account' : 'Account Help';
    }
    thorUpdateButtons();
    thorSelectionChanged = function (sender) {
      const index = Number(sender.indexOfSelectedItem);
      const choice = thorChoices[index];
      thorServer.stringValue = choice.apiBase;
      if (index !== 3) thorKind.selectItemAtIndex(choice.kind === 'local' ? 1 : 0);
      thorKind.hidden = index !== 3;
      thorKindLabel.hidden = index !== 3;
      thorUsername.stringValue = '';
      thorPassword.stringValue = '';
      thorAlert.informativeText = index === 0
        ? 'Sign in or create a GrayMatter Cloud account. Your password is never saved.'
        : 'Use an account on your local / self-hosted instance. GrayMatter Lite keeps local credentials in a private profile file.';
      thorUpdateButtons();
    };
    thorAlert.accessoryView = thorView;
    thorAlert.window.setInitialFirstResponder(thorRememberedUsername ? thorPassword : thorUsername);
    thorAlert.window.level = thorOpenedBrowser ? $.NSNormalWindowLevel : $.NSFloatingWindowLevel;
    thorAlert.window.center;
    if (!thorOpenedBrowser) {
      thorHost.activate();
      thorApplication.activateIgnoringOtherApps(true);
    }
    const thorResponse = Number(thorAlert.runModal);
    thorRememberedUsername = ObjC.unwrap(thorUsername.stringValue).trim();
    thorRememberedBase = ObjC.unwrap(thorServer.stringValue).trim();
    thorRememberedKind = Number(thorPicker.indexOfSelectedItem) === 3
      ? (Number(thorKind.indexOfSelectedItem) === 1 ? 'local' : 'hosted')
      : thorChoices[Number(thorPicker.indexOfSelectedItem)].kind;
    if (thorResponse === 1001 || thorResponse === 1002) {
      const thorIsCloud = thorRememberedBase.replace(/\/+$/, '') === thorCloudBase;
      const thorUrl = thorIsCloud ? $.NSURL.URLWithString(thorResponse === 1001 ? thorSignupUrl : thorRecoveryUrl) : thorInstanceUrl(thorRememberedBase);
      if (!thorUrl) {
        thorGuidance = 'Enter a valid HTTP or HTTPS instance URL before opening account setup.';
        thorGuidanceIsError = true;
        continue;
      }
      $.NSWorkspace.sharedWorkspace.openURL(thorUrl);
      thorGuidance = thorIsCloud
        ? 'Finish creating or recovering your account in the browser. Then return here and sign in with your username.'
        : 'Use the account configured on this instance. For GrayMatter Lite, the setup command provides your local account. Cloud signup is optional.';
      thorGuidanceIsError = false;
      thorOpenedBrowser = true;
      continue;
    }
    if (thorResponse !== 1000) $.exit(4);
    const thorPasswordValue = ObjC.unwrap(thorPassword.stringValue);
    if (!thorRememberedUsername || !thorPasswordValue || !thorRememberedBase) {
      thorGuidance = 'Enter the server URL, username and password to sign in securely.';
      thorGuidanceIsError = true;
      thorOpenedBrowser = false;
      continue;
    }
    return JSON.stringify({ username: thorRememberedUsername, password: thorPasswordValue, apiBase: thorRememberedBase, kind: thorRememberedKind });
  }
}

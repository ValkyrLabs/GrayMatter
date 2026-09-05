ObjC.import('Cocoa');
ObjC.import('stdlib');

function thorEnvironmentValue(thorName) {
  const thorValue = $.NSProcessInfo.processInfo.environment.objectForKey(thorName);
  return thorValue ? ObjC.unwrap(thorValue) : '';
}

function thorLabel(thorText, thorFrame) {
  const thorControl = $.NSTextField.labelWithString(thorText);
  thorControl.frame = thorFrame;
  return thorControl;
}

function run() {
  const thorSignupUrl = thorEnvironmentValue('GRAYMATTER_SIGNUP_URL');
  const thorRecoveryUrl = thorEnvironmentValue('GRAYMATTER_RECOVERY_URL');
  const thorDefaultUsername = thorEnvironmentValue('GRAYMATTER_DEFAULT_USERNAME');
  const thorErrorMessage = thorEnvironmentValue('GRAYMATTER_AUTH_ERROR');
  const thorHost = Application.currentApplication();
  thorHost.includeStandardAdditions = true;
  const thorApplication = $.NSApplication.sharedApplication;
  thorApplication.setActivationPolicy($.NSApplicationActivationPolicyRegular);
  let thorRememberedUsername = thorDefaultUsername;
  let thorGuidance = thorErrorMessage || 'Enter your GrayMatter username. Your password is never saved.';
  let thorGuidanceIsError = Boolean(thorErrorMessage);
  let thorOpenedBrowser = false;

  while (true) {
    const thorAlert = $.NSAlert.alloc.init;
    thorAlert.messageText = 'Sign in to GrayMatter';
    thorAlert.informativeText = thorGuidance;
    thorAlert.alertStyle = thorGuidanceIsError ? $.NSAlertStyleCritical : $.NSAlertStyleInformational;
    thorAlert.addButtonWithTitle('Sign In');
    thorAlert.addButtonWithTitle('Create Free Account');
    thorAlert.addButtonWithTitle('Recover Account');
    thorAlert.addButtonWithTitle('Cancel');

    const thorView = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, 380, 104));
    const thorUsernameLabel = thorLabel('Username', $.NSMakeRect(0, 82, 380, 18));
    const thorUsername = $.NSTextField.alloc.initWithFrame($.NSMakeRect(0, 54, 380, 26));
    thorUsername.placeholderString = 'username';
    thorUsername.stringValue = thorRememberedUsername;
    const thorPasswordLabel = thorLabel('Password', $.NSMakeRect(0, 30, 380, 18));
    const thorPassword = $.NSSecureTextField.alloc.initWithFrame($.NSMakeRect(0, 2, 380, 26));
    thorPassword.placeholderString = 'Required; never saved';
    thorView.addSubview(thorUsernameLabel);
    thorView.addSubview(thorUsername);
    thorView.addSubview(thorPasswordLabel);
    thorView.addSubview(thorPassword);
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
    if (thorResponse === 1001) {
      $.NSWorkspace.sharedWorkspace.openURL($.NSURL.URLWithString(thorSignupUrl));
      thorGuidance = 'Finish creating your free account in the browser. Then return here and sign in with your username.';
      thorGuidanceIsError = false;
      thorOpenedBrowser = true;
      continue;
    }
    if (thorResponse === 1002) {
      $.NSWorkspace.sharedWorkspace.openURL($.NSURL.URLWithString(thorRecoveryUrl));
      thorGuidance = 'Finish recovering your account in the browser. Then return here and sign in with your username.';
      thorGuidanceIsError = false;
      thorOpenedBrowser = true;
      continue;
    }
    if (thorResponse !== 1000) $.exit(4);

    const thorUsernameValue = thorRememberedUsername;
    const thorPasswordValue = ObjC.unwrap(thorPassword.stringValue);
    if (!thorUsernameValue || !thorPasswordValue) {
      thorGuidance = 'Enter your username and password to sign in securely.';
      thorGuidanceIsError = true;
      thorOpenedBrowser = false;
      continue;
    }
    return JSON.stringify({ username: thorUsernameValue, password: thorPasswordValue });
  }
}

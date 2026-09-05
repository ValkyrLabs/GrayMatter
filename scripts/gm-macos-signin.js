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
  const thorDefaultUsername = thorEnvironmentValue('GRAYMATTER_DEFAULT_USERNAME');
  const thorErrorMessage = thorEnvironmentValue('GRAYMATTER_AUTH_ERROR');
  const thorHost = Application.currentApplication();
  thorHost.includeStandardAdditions = true;
  const thorApplication = $.NSApplication.sharedApplication;
  thorApplication.setActivationPolicy($.NSApplicationActivationPolicyRegular);

  while (true) {
    const thorAlert = $.NSAlert.alloc.init;
    thorAlert.messageText = 'Sign in to GrayMatter';
    thorAlert.informativeText = thorErrorMessage || 'Give your AI agents secure, durable memory. Your password is never saved.';
    thorAlert.alertStyle = thorErrorMessage ? $.NSAlertStyleCritical : $.NSAlertStyleInformational;
    thorAlert.addButtonWithTitle('Sign In');
    thorAlert.addButtonWithTitle('Create Account');
    thorAlert.addButtonWithTitle('Cancel');

    const thorView = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, 380, 104));
    const thorUsernameLabel = thorLabel('Username', $.NSMakeRect(0, 82, 380, 18));
    const thorUsername = $.NSTextField.alloc.initWithFrame($.NSMakeRect(0, 54, 380, 26));
    thorUsername.placeholderString = 'name or email';
    thorUsername.stringValue = thorDefaultUsername;
    const thorPasswordLabel = thorLabel('Password', $.NSMakeRect(0, 30, 380, 18));
    const thorPassword = $.NSSecureTextField.alloc.initWithFrame($.NSMakeRect(0, 2, 380, 26));
    thorPassword.placeholderString = 'password';
    thorView.addSubview(thorUsernameLabel);
    thorView.addSubview(thorUsername);
    thorView.addSubview(thorPasswordLabel);
    thorView.addSubview(thorPassword);
    thorAlert.accessoryView = thorView;
    thorAlert.window.setInitialFirstResponder(thorDefaultUsername ? thorPassword : thorUsername);

    thorAlert.window.level = $.NSFloatingWindowLevel;
    thorAlert.window.center;
    thorHost.activate();
    thorApplication.activateIgnoringOtherApps(true);
    const thorResponse = Number(thorAlert.runModal);
    if (thorResponse === 1001) {
      $.NSWorkspace.sharedWorkspace.openURL($.NSURL.URLWithString(thorSignupUrl));
      continue;
    }
    if (thorResponse !== 1000) $.exit(4);

    const thorUsernameValue = ObjC.unwrap(thorUsername.stringValue).trim();
    const thorPasswordValue = ObjC.unwrap(thorPassword.stringValue);
    if (!thorUsernameValue || !thorPasswordValue) {
      const thorValidation = $.NSAlert.alloc.init;
      thorValidation.messageText = 'Username and password are required';
      thorValidation.informativeText = 'Enter both fields to sign in securely.';
      thorValidation.alertStyle = $.NSAlertStyleWarning;
      thorValidation.runModal;
      continue;
    }
    return JSON.stringify({ username: thorUsernameValue, password: thorPasswordValue });
  }
}

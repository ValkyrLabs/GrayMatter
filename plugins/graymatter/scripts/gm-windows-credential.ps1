param(
  [Parameter(Mandatory = $true)][ValidateSet('Prompt', 'Read', 'Write', 'Delete')][string]$Action,
  [string]$Target = '',
  [string]$UserName = 'default',
  [string]$SignupUrl = 'https://valkyrlabs.com/graymatter/cloud/signup?source=graymatter&intent=signup',
  [string]$RecoveryUrl = 'https://valkyrlabs.com/forgot-password?source=graymatter',
  [string]$DefaultUsername = '',
  [string]$ErrorMessage = '',
  [string]$DefaultApiBase = 'https://api-0.valkyrlabs.com/v1',
  [ValidateSet('hosted', 'local')][string]$DefaultConnectionKind = 'hosted'
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class GrayMatterCredentialManager {
    private const int ChunkBytes = 1500;
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL {
        public uint Flags; public uint Type; public string TargetName; public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;
        public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
    }
    [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool CredWrite(ref CREDENTIAL credential, uint flags);
    [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
    [DllImport("advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool CredDelete(string target, uint type, uint flags);
    [DllImport("advapi32.dll", SetLastError=true)] private static extern void CredFree(IntPtr buffer);

    private static void WriteRaw(string target, string userName, string secret) {
        byte[] bytes = Encoding.UTF8.GetBytes(secret);
        IntPtr blob = Marshal.AllocHGlobal(bytes.Length);
        try {
            Marshal.Copy(bytes, 0, blob, bytes.Length);
            CREDENTIAL credential = new CREDENTIAL { Type=1, TargetName=target, UserName=userName, CredentialBlobSize=(uint)bytes.Length, CredentialBlob=blob, Persist=2 };
            if (!CredWrite(ref credential, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        } finally { Marshal.FreeHGlobal(blob); }
    }
    private static string ReadRaw(string target) {
        IntPtr pointer;
        if (!CredRead(target, 1, 0, out pointer)) return "";
        try {
            CREDENTIAL credential = (CREDENTIAL)Marshal.PtrToStructure(pointer, typeof(CREDENTIAL));
            byte[] bytes = new byte[credential.CredentialBlobSize];
            Marshal.Copy(credential.CredentialBlob, bytes, 0, bytes.Length);
            return Encoding.UTF8.GetString(bytes);
        } finally { CredFree(pointer); }
    }
    private static void DeleteRaw(string target) { CredDelete(target, 1, 0); }

    private static int ReadPartCount(string target) {
        string metadata = ReadRaw(target + ":parts");
        if (!metadata.StartsWith("v1:")) return 0;
        int count;
        return Int32.TryParse(metadata.Substring(3), out count) && count > 0 ? count : 0;
    }

    private static void DeleteParts(string target) {
        int count = ReadPartCount(target);
        for (int index = 0; index < count; index++) DeleteRaw(target + ":part:" + index);
        DeleteRaw(target + ":parts");
    }

    public static void Write(string target, string userName, string secret) {
        byte[] bytes = Encoding.UTF8.GetBytes(secret);
        if (bytes.Length <= ChunkBytes) {
            WriteRaw(target, userName, secret);
            DeleteParts(target);
            return;
        }

        int oldCount = ReadPartCount(target);
        int count = (bytes.Length + ChunkBytes - 1) / ChunkBytes;
        for (int index = 0; index < count; index++) {
            int offset = index * ChunkBytes;
            int length = Math.Min(ChunkBytes, bytes.Length - offset);
            byte[] chunk = new byte[length];
            Buffer.BlockCopy(bytes, offset, chunk, 0, length);
            WriteRaw(target + ":part:" + index, userName, Convert.ToBase64String(chunk));
        }
        WriteRaw(target + ":parts", userName, "v1:" + count);
        DeleteRaw(target);
        for (int index = count; index < oldCount; index++) DeleteRaw(target + ":part:" + index);
    }

    public static string Read(string target) {
        string direct = ReadRaw(target);
        if (!String.IsNullOrEmpty(direct)) return direct;
        int count = ReadPartCount(target);
        if (count == 0) return "";
        using (System.IO.MemoryStream stream = new System.IO.MemoryStream()) {
            for (int index = 0; index < count; index++) {
                string encoded = ReadRaw(target + ":part:" + index);
                if (String.IsNullOrEmpty(encoded)) return "";
                byte[] chunk = Convert.FromBase64String(encoded);
                stream.Write(chunk, 0, chunk.Length);
            }
            return Encoding.UTF8.GetString(stream.ToArray());
        }
    }

    public static void Delete(string target) {
        DeleteRaw(target);
        DeleteParts(target);
    }
}
'@

switch ($Action) {
  'Read' { [Console]::Out.Write([GrayMatterCredentialManager]::Read($Target)) }
  'Write' {
    $thor_secret = [Console]::In.ReadToEnd()
    [GrayMatterCredentialManager]::Write($Target, $UserName, $thor_secret)
  }
  'Delete' { [GrayMatterCredentialManager]::Delete($Target) }
  'Prompt' {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $thor_form = New-Object System.Windows.Forms.Form
    $thor_form.Text = 'GrayMatter Sign In'
    $thor_form.StartPosition = 'CenterScreen'
    $thor_form.FormBorderStyle = 'FixedDialog'
    $thor_form.MaximizeBox = $false
    $thor_form.MinimizeBox = $false
    $thor_form.ClientSize = New-Object System.Drawing.Size(480, 430)

    $thor_intro = New-Object System.Windows.Forms.Label
    $thor_intro.Text = if ($ErrorMessage) { $ErrorMessage } else { 'Choose Cloud or your local / self-hosted instance. Use your instance account; Cloud signup is optional.' }
    $thor_intro.ForeColor = if ($ErrorMessage) { [System.Drawing.Color]::Firebrick } else { [System.Drawing.SystemColors]::ControlText }
    $thor_intro.SetBounds(20, 16, 440, 42)
    $thor_form.Controls.Add($thor_intro)
    $thor_connectionLabel = New-Object System.Windows.Forms.Label
    $thor_connectionLabel.Text = 'Connection'
    $thor_connectionLabel.SetBounds(20, 65, 90, 20)
    $thor_form.Controls.Add($thor_connectionLabel)
    $thor_connection = New-Object System.Windows.Forms.ComboBox
    $thor_connection.DropDownStyle = 'DropDownList'
    $thor_connection.AccessibleName = 'GrayMatter connection'
    $thor_connection.SetBounds(115, 62, 345, 26)
    @('GrayMatter Cloud (api-0)', 'Local GrayMatter Lite (localhost:8787)', 'Local ValkyrAI (localhost:8080)', 'Other self-hosted server') | ForEach-Object { [void]$thor_connection.Items.Add($_) }
    $thor_bases = @('https://api-0.valkyrlabs.com/v1', 'http://localhost:8787/v1', 'http://localhost:8080/v1', '')
    $thor_kinds = @('hosted', 'local', 'hosted', 'hosted')
    $thor_index = 3
    for ($thor_i = 0; $thor_i -lt 3; $thor_i++) {
      if ($DefaultApiBase -eq $thor_bases[$thor_i] -and $DefaultConnectionKind -eq $thor_kinds[$thor_i]) { $thor_index = $thor_i }
    }
    $thor_connection.SelectedIndex = $thor_index
    $thor_form.Controls.Add($thor_connection)
    $thor_serverLabel = New-Object System.Windows.Forms.Label
    $thor_serverLabel.Text = 'Server URL'
    $thor_serverLabel.SetBounds(20, 108, 90, 20)
    $thor_form.Controls.Add($thor_serverLabel)
    $thor_server = New-Object System.Windows.Forms.TextBox
    $thor_server.Text = $DefaultApiBase
    $thor_server.AccessibleName = 'GrayMatter server URL'
    $thor_server.SetBounds(115, 105, 345, 26)
    $thor_form.Controls.Add($thor_server)
    $thor_kindLabel = New-Object System.Windows.Forms.Label
    $thor_kindLabel.Text = 'Instance type'
    $thor_kindLabel.SetBounds(20, 151, 90, 20)
    $thor_kindLabel.Visible = $thor_index -eq 3
    $thor_form.Controls.Add($thor_kindLabel)
    $thor_kind = New-Object System.Windows.Forms.ComboBox
    $thor_kind.DropDownStyle = 'DropDownList'
    [void]$thor_kind.Items.Add('ValkyrAI account')
    [void]$thor_kind.Items.Add('GrayMatter Lite local account')
    $thor_kind.SelectedIndex = if ($DefaultConnectionKind -eq 'local') { 1 } else { 0 }
    $thor_kind.SetBounds(115, 148, 345, 26)
    $thor_kind.Visible = $thor_index -eq 3
    $thor_form.Controls.Add($thor_kind)
    $thor_localHint = New-Object System.Windows.Forms.Label
    $thor_localHint.Text = 'Self-hosted accounts come from your instance setup or administrator.'
    $thor_localHint.SetBounds(20, 187, 440, 34)
    $thor_form.Controls.Add($thor_localHint)
    function OpenGrayMatterInstance {
      $thor_uri = $null
      if (-not [System.Uri]::TryCreate(($thor_server.Text.Trim() -replace '/v1/?$', ''), [System.UriKind]::Absolute, [ref]$thor_uri) -or
        $thor_uri.Scheme -notin @('http', 'https') -or -not $thor_uri.Host -or $thor_uri.UserInfo -or $thor_uri.Query -or $thor_uri.Fragment) {
        $thor_intro.Text = 'Enter a valid HTTP or HTTPS instance URL before opening account setup.'
        $thor_intro.ForeColor = [System.Drawing.Color]::Firebrick
        return
      }
      Start-Process $thor_uri.AbsoluteUri
    }
    $thor_userLabel = New-Object System.Windows.Forms.Label
    $thor_userLabel.Text = 'Username'
    $thor_userLabel.SetBounds(20, 229, 90, 20)
    $thor_form.Controls.Add($thor_userLabel)
    $thor_user = New-Object System.Windows.Forms.TextBox
    $thor_user.Text = $DefaultUsername
    $thor_user.AccessibleName = 'GrayMatter username'
    $thor_user.SetBounds(115, 226, 345, 24)
    $thor_form.Controls.Add($thor_user)
    $thor_passwordLabel = New-Object System.Windows.Forms.Label
    $thor_passwordLabel.Text = 'Password'
    $thor_passwordLabel.SetBounds(20, 266, 90, 20)
    $thor_form.Controls.Add($thor_passwordLabel)
    $thor_password = New-Object System.Windows.Forms.TextBox
    $thor_password.UseSystemPasswordChar = $true
    $thor_password.AccessibleName = 'Password for the selected GrayMatter instance'
    $thor_password.SetBounds(115, 263, 345, 24)
    $thor_form.Controls.Add($thor_password)
    $thor_signup = New-Object System.Windows.Forms.LinkLabel
    $thor_signup.Text = 'New to GrayMatter? Create a free account'
    $thor_signup.SetBounds(20, 305, 420, 24)
    $thor_signup.Add_LinkClicked({
      $thor_form.TopMost = $false
      $thor_cloud = $thor_server.Text.Trim().TrimEnd('/') -eq $thor_bases[0]
      $thor_intro.Text = if ($thor_cloud) { 'Finish creating your account in the browser, then return here and sign in with your username.' } else { 'Use an account from your instance setup or administrator. Cloud signup is optional.' }
      $thor_intro.ForeColor = [System.Drawing.SystemColors]::ControlText
      if ($thor_cloud) { Start-Process $SignupUrl } else { OpenGrayMatterInstance }
    })
    $thor_form.Controls.Add($thor_signup)
    $thor_recovery = New-Object System.Windows.Forms.LinkLabel
    $thor_recovery.Text = 'Forgot your username or password?'
    $thor_recovery.SetBounds(20, 335, 420, 24)
    $thor_recovery.Add_LinkClicked({
      $thor_form.TopMost = $false
      $thor_cloud = $thor_server.Text.Trim().TrimEnd('/') -eq $thor_bases[0]
      $thor_intro.Text = if ($thor_cloud) { 'Finish recovering your account in the browser, then return here and sign in with your username.' } else { 'Recover the account on your self-hosted instance or contact its administrator.' }
      $thor_intro.ForeColor = [System.Drawing.SystemColors]::ControlText
      if ($thor_cloud) { Start-Process $RecoveryUrl } else { OpenGrayMatterInstance }
    })
    $thor_form.Controls.Add($thor_recovery)
    $thor_cancel = New-Object System.Windows.Forms.Button
    $thor_cancel.Text = 'Cancel'
    $thor_cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $thor_cancel.SetBounds(290, 383, 80, 30)
    $thor_form.Controls.Add($thor_cancel)
    $thor_signin = New-Object System.Windows.Forms.Button
    $thor_signin.Text = 'Sign In'
    $thor_signin.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $thor_signin.SetBounds(380, 383, 80, 30)
    $thor_form.Controls.Add($thor_signin)
    $thor_updateLinks = {
      $thor_cloud = $thor_server.Text.Trim().TrimEnd('/') -eq $thor_bases[0]
      $thor_signup.Text = if ($thor_cloud) { 'New to GrayMatter? Create a free account' } else { 'Open your local / self-hosted instance' }
      $thor_recovery.Text = if ($thor_cloud) { 'Forgot your username or password?' } else { 'Account help on this instance' }
    }
    $thor_server.Add_TextChanged($thor_updateLinks)
    $thor_connection.Add_SelectedIndexChanged({
      $thor_selected = $thor_connection.SelectedIndex
      $thor_server.Text = $thor_bases[$thor_selected]
      if ($thor_selected -ne 3) { $thor_kind.SelectedIndex = if ($thor_kinds[$thor_selected] -eq 'local') { 1 } else { 0 } }
      $thor_kind.Visible = $thor_selected -eq 3
      $thor_kindLabel.Visible = $thor_selected -eq 3
      $thor_user.Text = ''
      $thor_password.Text = ''
      $thor_intro.Text = 'Use the account on your selected instance. Cloud signup is optional for self-hosted servers.'
      $thor_localHint.Text = if ($thor_selected -eq 1) { 'GrayMatter Lite keeps local credentials in a private profile file.' } else { 'Your password is never saved; only the returned session is stored.' }
      & $thor_updateLinks
    })
    $thor_kind.Add_SelectedIndexChanged({
      $thor_localHint.Text = if ($thor_kind.SelectedIndex -eq 1) { 'GrayMatter Lite keeps local credentials in a private profile file.' } else { 'Your password is never saved; only the returned session is stored.' }
    })
    & $thor_updateLinks
    $thor_form.AcceptButton = $thor_signin
    $thor_form.CancelButton = $thor_cancel
    $thor_form.Topmost = $true
    $thor_form.Add_Shown({ if ($DefaultUsername) { $thor_password.Select() } else { $thor_user.Select() } })
    do {
      if ($thor_form.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 4 }
      if (-not $thor_user.Text.Trim() -or -not $thor_password.Text -or -not $thor_server.Text.Trim()) {
        [System.Windows.Forms.MessageBox]::Show($thor_form, 'Enter the server URL, username and password to sign in securely.', 'GrayMatter', 'OK', 'Warning') | Out-Null
        $thor_form.DialogResult = [System.Windows.Forms.DialogResult]::None
      }
    } while (-not $thor_user.Text.Trim() -or -not $thor_password.Text -or -not $thor_server.Text.Trim())
    $thor_instanceKind = if ($thor_connection.SelectedIndex -eq 3) { if ($thor_kind.SelectedIndex -eq 1) { 'local' } else { 'hosted' } } else { $thor_kinds[$thor_connection.SelectedIndex] }
    @{ username = $thor_user.Text.Trim(); password = $thor_password.Text; apiBase = $thor_server.Text.Trim(); kind = $thor_instanceKind } | ConvertTo-Json -Compress
  }
}

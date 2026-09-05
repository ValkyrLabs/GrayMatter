param(
  [Parameter(Mandatory = $true)][ValidateSet('Prompt', 'Read', 'Write', 'Delete')][string]$Action,
  [string]$Target = '',
  [string]$UserName = 'default',
  [string]$SignupUrl = 'https://valkyrlabs.com/graymatter/activate',
  [string]$DefaultUsername = '',
  [string]$ErrorMessage = ''
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
    $thor_form.ClientSize = New-Object System.Drawing.Size(440, 260)

    $thor_intro = New-Object System.Windows.Forms.Label
    $thor_intro.Text = if ($ErrorMessage) { $ErrorMessage } else { 'Give your AI agents secure, durable memory. Your password is never saved.' }
    $thor_intro.ForeColor = if ($ErrorMessage) { [System.Drawing.Color]::Firebrick } else { [System.Drawing.SystemColors]::ControlText }
    $thor_intro.SetBounds(20, 16, 400, 42)
    $thor_form.Controls.Add($thor_intro)
    $thor_userLabel = New-Object System.Windows.Forms.Label
    $thor_userLabel.Text = 'Username'
    $thor_userLabel.SetBounds(20, 72, 90, 20)
    $thor_form.Controls.Add($thor_userLabel)
    $thor_user = New-Object System.Windows.Forms.TextBox
    $thor_user.Text = $DefaultUsername
    $thor_user.SetBounds(115, 69, 305, 24)
    $thor_form.Controls.Add($thor_user)
    $thor_passwordLabel = New-Object System.Windows.Forms.Label
    $thor_passwordLabel.Text = 'Password'
    $thor_passwordLabel.SetBounds(20, 109, 90, 20)
    $thor_form.Controls.Add($thor_passwordLabel)
    $thor_password = New-Object System.Windows.Forms.TextBox
    $thor_password.UseSystemPasswordChar = $true
    $thor_password.SetBounds(115, 106, 305, 24)
    $thor_form.Controls.Add($thor_password)
    $thor_signup = New-Object System.Windows.Forms.LinkLabel
    $thor_signup.Text = 'Create an account or recover access'
    $thor_signup.SetBounds(20, 149, 250, 24)
    $thor_signup.Add_LinkClicked({ Start-Process $SignupUrl })
    $thor_form.Controls.Add($thor_signup)
    $thor_cancel = New-Object System.Windows.Forms.Button
    $thor_cancel.Text = 'Cancel'
    $thor_cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $thor_cancel.SetBounds(250, 205, 80, 30)
    $thor_form.Controls.Add($thor_cancel)
    $thor_signin = New-Object System.Windows.Forms.Button
    $thor_signin.Text = 'Sign In'
    $thor_signin.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $thor_signin.SetBounds(340, 205, 80, 30)
    $thor_form.Controls.Add($thor_signin)
    $thor_form.AcceptButton = $thor_signin
    $thor_form.CancelButton = $thor_cancel
    $thor_form.Topmost = $true
    $thor_form.Add_Shown({ if ($DefaultUsername) { $thor_password.Select() } else { $thor_user.Select() } })
    do {
      if ($thor_form.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 4 }
      if (-not $thor_user.Text.Trim() -or -not $thor_password.Text) {
        [System.Windows.Forms.MessageBox]::Show($thor_form, 'Enter both your username and password to sign in securely.', 'GrayMatter', 'OK', 'Warning') | Out-Null
        $thor_form.DialogResult = [System.Windows.Forms.DialogResult]::None
      }
    } while (-not $thor_user.Text.Trim() -or -not $thor_password.Text)
    @{ username = $thor_user.Text; password = $thor_password.Text } | ConvertTo-Json -Compress
  }
}

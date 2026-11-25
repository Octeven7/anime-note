Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$progressMutex = New-Object System.Threading.Mutex($false, 'Local\AnimeNotePopularPosterProgress')
if (-not $progressMutex.WaitOne(0)) { $progressMutex.Dispose(); exit }
$progressStatusPath = Join-Path $PSScriptRoot '..\.local\popular-posters\status.json'
$progressForm = New-Object System.Windows.Forms.Form
$progressForm.Text = 'Popular poster download'
$progressForm.ClientSize = New-Object System.Drawing.Size(440, 215)
$progressForm.StartPosition = 'CenterScreen'
$progressForm.FormBorderStyle = 'FixedDialog'
$progressForm.MaximizeBox = $false
$progressForm.BackColor = [System.Drawing.Color]::FromArgb(247, 244, 237)
$progressForm.Font = New-Object System.Drawing.Font('Segoe UI', 11)
$progressNumber = New-Object System.Windows.Forms.Label
$progressNumber.SetBounds(24, 22, 395, 60)
$progressNumber.Font = New-Object System.Drawing.Font('Segoe UI', 30)
$progressNumber.Text = '-- / --'
$progressDetails = New-Object System.Windows.Forms.Label
$progressDetails.SetBounds(28, 92, 385, 50)
$progressDetails.Text = 'Waiting for status...'
$progressHint = New-Object System.Windows.Forms.Label
$progressHint.SetBounds(28, 157, 385, 42)
$progressHint.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$progressHint.Text = "Updates every second.`nClosing this window does not stop the worker."
$progressForm.Controls.AddRange(@($progressNumber, $progressDetails, $progressHint))
$progressTimer = New-Object System.Windows.Forms.Timer
$progressTimer.Interval = 1000
$progressRefresh = {
    try {
        $progressData = Get-Content -LiteralPath $progressStatusPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
        $progressNumber.Text = '{0} / {1}' -f ($progressData.cached + $progressData.downloaded), $progressData.total
        $progressState = [string]$progressData.state
        if ($progressState -eq 'running' -or $progressState -eq 'starting') {
            if (-not (Get-Process -Id $progressData.pid -ErrorAction SilentlyContinue)) { $progressState = 'interrupted - restart to resume' }
        }
        $progressDetails.Text = "${progressState}    Limit: $($progressData.targetRate) requests/s`nProcessed: $($progressData.processed)    Failed: $(@($progressData.failed).Count)    Missing: $($progressData.missing)"
    } catch {
        # A concurrent status write can briefly produce incomplete JSON. Retain the last reading.
    }
}
$progressTimer.Add_Tick($progressRefresh)
$progressForm.Add_Shown({ & $progressRefresh; $progressTimer.Start() })
try { [void]$progressForm.ShowDialog() }
finally { $progressTimer.Stop(); $progressTimer.Dispose(); $progressForm.Dispose(); $progressMutex.ReleaseMutex(); $progressMutex.Dispose() }

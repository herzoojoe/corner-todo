# =========================================
# Corner Todo 열기
# 할 일 앱을 주소창 없는 창으로 열고,
# 모니터 오른쪽 위에 항상 같은 크기로 놓아 줍니다.
# =========================================

# ---- 원하는 대로 바꿀 수 있는 값 ----
$Width  = 400    # 창 가로 크기 (화면 배율 100% 기준)
$Height = 780    # 창 세로 크기
$Margin = 8      # 화면 가장자리와 띄울 간격
$Title  = 'Corner Todo'   # index.html의 <title>과 같아야 함

# ---- 이 파일이 있는 폴더의 index.html 주소 만들기 ----
$path = Join-Path $PSScriptRoot 'index.html'
$Url  = 'file:///' + (($path -replace '\\', '/') -replace ' ', '%20')

# ---- 크롬 위치 찾기 (흔한 설치 위치 3곳) ----
$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chrome) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show('크롬을 찾지 못했습니다.') | Out-Null
  exit
}

# ---- Windows에게 창 위치를 직접 지시하는 도구 불러오기 ----
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hgt, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint act, uint p, ref RECT r, uint w);
}
"@
[Win]::SetProcessDPIAware() | Out-Null   # 화면 배율(125%, 150% 등)을 정확히 계산하기 위해

# ---- 이미 열려 있으면 그 창을 쓰고, 없으면 새로 열기 ----
$hwnd = [Win]::FindWindow([NullString]::Value, $Title)
if ($hwnd -eq [IntPtr]::Zero) {
  Start-Process -FilePath $chrome -ArgumentList "--app=`"$Url`""
  for ($i = 0; $i -lt 50 -and $hwnd -eq [IntPtr]::Zero; $i++) {   # 최대 10초 기다림
    Start-Sleep -Milliseconds 200
    $hwnd = [Win]::FindWindow([NullString]::Value, $Title)
  }
}
if ($hwnd -eq [IntPtr]::Zero) { exit }

# ---- 오른쪽 위 자리 계산 (작업 표시줄을 뺀 화면 영역 기준) ----
$area = New-Object Win+RECT
[Win]::SystemParametersInfo(0x0030, 0, [ref]$area, 0) | Out-Null   # 0x30 = 작업 영역 가져오기

$dpi = [Win]::GetDpiForWindow($hwnd)
$scale = if ($dpi -gt 0) { $dpi / 96 } else { 1 }
$w = [int]($Width  * $scale)
$h = [int]($Height * $scale)
$m = [int]($Margin * $scale)
$x = $area.Right - $w - $m
$y = $area.Top + $m

# ---- 창 놓기 ----
[Win]::ShowWindow($hwnd, 9) | Out-Null                       # 최소화돼 있으면 되살리기
[Win]::SetWindowPos($hwnd, [IntPtr]::Zero, $x, $y, $w, $h, 0x0040) | Out-Null
[Win]::SetForegroundWindow($hwnd) | Out-Null

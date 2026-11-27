import { execFileSync } from 'node:child_process';
import http from 'node:http';

const windowsProxyLookup = `
$ErrorActionPreference = 'Stop'
$settings = [System.Net.WebRequest]::DefaultWebProxy
$results = @{}
foreach ($hostName in @('api.bgm.tv', 'lain.bgm.tv')) {
  $target = [Uri]("https://" + $hostName + "/")
  $proxy = $settings.GetProxy($target)
  if ($proxy -ne $target) { $results[$hostName] = $proxy.AbsoluteUri }
}
ConvertTo-Json -InputObject $results -Compress
`;

export function configureNetworkProxy() {
  if (!http.setGlobalProxyFromEnv) return;

  const httpProxy = process.env.http_proxy || process.env.HTTP_PROXY;
  let httpsProxy = process.env.https_proxy || process.env.HTTPS_PROXY;
  const bypass = [process.env.no_proxy || process.env.NO_PROXY, 'localhost', '127.0.0.1', '[::1]'];

  if (!httpProxy && !httpsProxy && process.platform === 'win32') {
    try {
      const proxies = JSON.parse(
        execFileSync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', windowsProxyLookup],
          { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] },
        ),
      );
      const apiProxy = proxies['api.bgm.tv'];
      const imageProxy = proxies['lain.bgm.tv'];
      if (apiProxy && imageProxy && apiProxy !== imageProxy) {
        console.warn(
          'Windows selected different Bangumi proxies. Set HTTPS_PROXY for Paper Screen.',
        );
        return;
      }
      httpsProxy = imageProxy || apiProxy;
      if (!apiProxy) bypass.push('api.bgm.tv');
      if (!imageProxy) bypass.push('lain.bgm.tv');
    } catch {
      console.warn('Could not read the Windows system proxy. Paper Screen will connect directly.');
    }
  }

  if (!httpProxy && !httpsProxy) return;
  try {
    return http.setGlobalProxyFromEnv({
      http_proxy: httpProxy,
      https_proxy: httpsProxy,
      no_proxy: bypass.filter(Boolean).join(','),
    });
  } catch {
    console.warn('Paper Screen could not enable the configured HTTP proxy.');
  }
}

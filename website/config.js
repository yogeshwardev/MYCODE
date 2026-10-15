// Site settings. Update the version and checksums for each release.
// Cloudflare Pages can't serve files over 25 MiB, so installers are hosted on
// GitHub Releases.
(() => {
  const version = "1.1.0";
  const base = `https://github.com/yogeshwardev/MYCODE/releases/download/v${version}/`;
  window.SWARMCODE_SITE = {
    version,
    repoUrl: "https://github.com/yogeshwardev/MYCODE",
    releaseUrl: `https://github.com/yogeshwardev/MYCODE/releases/tag/v${version}`,
    downloads: {
      windows: { label: "Windows 10/11", file: `SwarmCode-Setup-${version}.exe`, size: "102 MB", sha256: "5e362f456615ed61d5411d1853baaab301da3736b75779d964f8b771338b75cf" },
      mac: { label: "macOS (Apple Silicon)", file: `SwarmCode-${version}-arm64.dmg`, size: "106 MB", sha256: "9d20ee6eadfbdfefc908f9f19d3d72b9b7f07264347fd85551f62d6d1cc0771d" },
      linux: { label: "Linux AppImage", file: `SwarmCode-${version}.AppImage`, size: "97 MB", sha256: "05d21779632cd06fbaa540a7e4b4f41c5ae0025f41935567ec1d9e6d04766b8f" },
      deb: { label: "Linux .deb", file: `swarmcode-desktop_${version}_amd64.deb`, size: "97 MB", sha256: "bb707eb3dfcc500d0682d9ced1d667ba972b43a56e85ecabd940596e3c9cdbb4" },
    },
    url(key) {
      return base + this.downloads[key].file;
    },
    /** Best guess at the visitor's platform. */
    platform() {
      const p = `${navigator.userAgentData?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent}`.toLowerCase();
      if (p.includes("mac")) return "mac";
      if (p.includes("linux") && !p.includes("android")) return "linux";
      return "windows";
    },
  };
})();

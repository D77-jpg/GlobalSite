const SITE_KEY = "globalsite.currentSiteId";
const PAGE_KEY = "globalsite.currentPageId";

export function rememberSite(id: string) {
  if (!/^[a-f0-9]{24}$/.test(id)) return;
  try {
    sessionStorage.setItem(SITE_KEY, id);
  } catch {
    /* private mode */
  }
}

export function readSite() {
  try {
    const id = sessionStorage.getItem(SITE_KEY) ?? "";
    return /^[a-f0-9]{24}$/.test(id) ? id : "";
  } catch {
    return "";
  }
}

export function rememberPage(siteId: string, pageId: string) {
  rememberSite(siteId);
  if (!/^[a-f0-9]{24}$/.test(pageId)) return;
  try {
    sessionStorage.setItem(PAGE_KEY, siteId + ":" + pageId);
  } catch {
    /* private mode */
  }
}

export function readPage(siteId: string) {
  try {
    const [site, page] = (sessionStorage.getItem(PAGE_KEY) ?? "").split(":");
    return site === siteId && /^[a-f0-9]{24}$/.test(page ?? "") ? page : "";
  } catch {
    return "";
  }
}

import { useEffect, useRef, useState } from "react";
import {
  MoreHorizontal,
  Download,
  ScanText,
  Trash2,
  FileText,
  ImageOff,
  X,
  ExternalLink,
} from "lucide-react";
import type { catalogText } from "./catalog-i18n";
import "./asset-library.css";
type Item = Record<string, any>;
type T = ReturnType<typeof catalogText>;
export function assetSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? (bytes / 1024 / 1024).toFixed(1) + " MB"
    : Math.max(1, Math.ceil(bytes / 1024)) + " KB";
}
export function AssetTile({
  asset,
  t,
  canEdit,
  busy,
  onPreview,
  onExtract,
  onDelete,
}: {
  asset: Item;
  t: T;
  canEdit: boolean;
  busy: boolean;
  onPreview: () => void;
  onExtract: () => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false),
    [broken, setBroken] = useState(false),
    [original, setOriginal] = useState(false),
    root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menu) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setMenu(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);
  return (
    <article className="asset-tile">
      <button
        type="button"
        className="asset-thumbnail"
        onClick={onPreview}
        aria-label={t("previewAsset") + " " + asset.fileName}
      >
        {asset.mime.startsWith("image/") && !broken ? (
          <img
            src={original ? asset.url : (asset.thumbnailUrl ?? asset.url)}
            alt=""
            loading="lazy"
            onError={() => {
              if (!original && asset.thumbnailUrl) {
                setOriginal(true);
              } else setBroken(true);
            }}
          />
        ) : (
          <span className="asset-file-icon">
            {asset.mime.startsWith("image/") ? (
              <ImageOff size={30} />
            ) : (
              <FileText size={34} />
            )}
            <span>
              {asset.mime.startsWith("image/") ? t("imageUnavailable") : "PDF"}
            </span>
          </span>
        )}
        <span className="asset-type">{t(asset.kind)}</span>
      </button>
      <div className="asset-tile-info">
        <h3>
          <button
            type="button"
            className="asset-name"
            onClick={onPreview}
            title={asset.fileName}
          >
            {asset.fileName}
          </button>
        </h3>
        <p>
          {assetSize(asset.bytes)}
          {asset.width ? " · " + asset.width + " × " + asset.height : ""}
        </p>
      </div>
      <div className="asset-menu" ref={root}>
        <button
          ref={trigger}
          type="button"
          className="asset-menu-trigger"
          aria-label={t("assetActions") + " " + asset.fileName}
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          <MoreHorizontal size={19} />
        </button>
        {menu && (
          <div className="asset-menu-content">
            <button
              type="button"
              onClick={() => {
                setMenu(false);
                onPreview();
              }}
            >
              <ExternalLink size={15} />
              {t("previewAsset")}
            </button>
            <a
              href={"/api/v1/assets/" + asset.id + "/download"}
              onClick={() => setMenu(false)}
            >
              <Download size={15} />
              {t("download")}
            </a>
            {canEdit && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setMenu(false);
                    onExtract();
                  }}
                >
                  <ScanText size={15} />
                  {t("extract")}
                </button>
                <button
                  type="button"
                  className="asset-delete"
                  disabled={busy}
                  onClick={() => {
                    setMenu(false);
                    onDelete();
                  }}
                >
                  <Trash2 size={15} />
                  {t("delete")}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
export function AssetPreview({
  asset,
  t,
  canEdit,
  busy,
  error,
  onClose,
  onExtract,
  onDelete,
}: {
  asset: Item;
  t: T;
  canEdit: boolean;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onExtract: () => void;
  onDelete: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [broken, setBroken] = useState(false);
  useEffect(() => {
    const d = dialog.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      className="asset-preview-dialog"
      ref={dialog}
      aria-label={t("previewAsset")}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
    >
      <header>
        <div>
          <span>{t(asset.kind)}</span>
          <h2>{asset.fileName}</h2>
        </div>
        <button
          className="asset-close"
          aria-label={t("close")}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      <div className="asset-preview-body">
        <div className="asset-full-image">
          {asset.mime.startsWith("image/") && !broken ? (
            <img
              alt={asset.fileName}
              src={asset.url}
              onError={() => setBroken(true)}
            />
          ) : (
            <div className="asset-file-icon">
              {broken ? <ImageOff size={42} /> : <FileText size={48} />}
              <p>{broken ? t("imageUnavailable") : t("pdfPreviewHint")}</p>
              <a href={"/api/v1/assets/" + asset.id + "/download"}>
                {t("download")}
              </a>
            </div>
          )}
        </div>
        <aside>
          <h3>{t("assetDetails")}</h3>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <dl>
            <div>
              <dt>{t("kind")}</dt>
              <dd>{t(asset.kind)}</dd>
            </div>
            <div>
              <dt>{t("fileSize")}</dt>
              <dd>{assetSize(asset.bytes)}</dd>
            </div>
            {asset.width > 0 && (
              <div>
                <dt>{t("dimensions")}</dt>
                <dd>
                  {asset.width} × {asset.height}
                </dd>
              </div>
            )}
            <div>
              <dt>{t("fileFormat")}</dt>
              <dd>{asset.mime}</dd>
            </div>
          </dl>
          <a
            className="button primary"
            href={"/api/v1/assets/" + asset.id + "/download"}
          >
            <Download size={16} />
            {t("download")}
          </a>
          {canEdit && (
            <>
              <button className="secondary" onClick={onExtract}>
                <ScanText size={16} />
                {t("extract")}
              </button>
              <button
                className="secondary asset-delete"
                disabled={busy}
                onClick={onDelete}
              >
                <Trash2 size={16} />
                {t("delete")}
              </button>
            </>
          )}
        </aside>
      </div>
    </dialog>
  );
}

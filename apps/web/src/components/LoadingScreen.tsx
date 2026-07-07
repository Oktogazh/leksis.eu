import { useTranslation } from "react-i18next";

export function LoadingScreen() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <div className="flex flex-col items-center gap-3 text-content-muted">
        <span
          className="h-6 w-6 animate-spin rounded-full border-2 border-t-primary"
          aria-hidden
        />
        <span className="text-sm">{t("common.loading")}</span>
      </div>
    </div>
  );
}

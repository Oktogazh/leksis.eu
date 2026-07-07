import { useTranslation } from "react-i18next";

export function Footer() {
  const { t } = useTranslation();
  return (
    <footer className="border-t">
      <div className="mx-auto w-full max-w-3xl px-4 py-4 text-xs text-content-subtle sm:px-6">
        {t("common.poweredBy")}
      </div>
    </footer>
  );
}

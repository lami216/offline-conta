// Desktop saves return only after the selected destination has been written.
export type BackupSaveResult = { saved: boolean; filePath: string | null; bytes?: number; canceled?: boolean };
type DesktopBackupReply = { ok: boolean; filePath?: string; bytes?: number; canceled?: boolean; error?: string; code?: string; status?: number | null };
declare global {
  interface Window {
    alkarnaBackup?: {
      save: () => Promise<DesktopBackupReply>;
      openFolder: () => Promise<{ ok: boolean; error?: string }>;
    };
  }
}
export const desktopBackupAvailable = () => typeof window !== 'undefined' && !!window.alkarnaBackup;
export async function exportNativeBackup(locale: 'ar' | 'fr'): Promise<BackupSaveResult> {
  if (window.alkarnaBackup) {
    const reply = await window.alkarnaBackup.save();
    if (reply.canceled) return { saved: false, filePath: null, canceled: true };
    if (!reply.ok || !reply.filePath) {
      const message = reply.status === 401 || reply.status === 403
        ? (locale === 'ar' ? 'لا تملك صلاحية إنشاء النسخة الاحتياطية أو انتهت الجلسة.' : 'Permission de sauvegarde absente ou session expirée.')
        : reply.code === 'ENOSPC'
          ? (locale === 'ar' ? 'لا توجد مساحة كافية لحفظ النسخة الاحتياطية.' : 'Espace disque insuffisant pour la sauvegarde.')
          : reply.code === 'EEXIST'
            ? (locale === 'ar' ? 'يوجد ملف بهذا الاسم. اختر اسمًا آخر.' : 'Ce fichier existe déjà. Choisissez un autre nom.')
            : (locale === 'ar' ? 'تعذر حفظ النسخة الاحتياطية. تحقق من المجلد أو اتصال الفلاشة. لم تتغير البيانات.' : 'Sauvegarde impossible. Vérifiez le dossier ou la connexion USB. Les données sont inchangées.');
      throw new Error(message);
    }
    return { saved: true, filePath: reply.filePath, bytes: reply.bytes };
  }
  const response = await fetch('/api/settings/backup');
  if (!response.ok) throw new Error(locale === 'ar' ? 'تعذر إنشاء النسخة' : 'Impossible de créer la sauvegarde');
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = response.headers.get('content-disposition')?.match(/filename="([^"]+)/)?.[1] ?? 'conta-backup.conta.json';
  document.body.appendChild(link);
  try { link.click(); } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  return { saved: false, filePath: null };
}
export async function openBackupFolder() {
  const reply = await window.alkarnaBackup?.openFolder();
  if (!reply?.ok) throw new Error('تعذر فتح مجلد النسخ / Impossible d’ouvrir le dossier de sauvegarde');
}

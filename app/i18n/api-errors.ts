import type { Locale } from "./locale";

const exactFrench: Record<string, string> = {
  "أُلغي طلب العملية قبل الحفظ؛ أعد المحاولة إذا لزم الأمر": "La demande a été annulée avant l’enregistrement. Réessayez si nécessaire.",
  "تعذر بدء العملية في الوقت المحدد؛ أعد المحاولة": "L’opération n’a pas pu démarrer à temps. Veuillez réessayer.",
  "تعذر التحقق من الطلب في الوقت المحدد؛ أعد المحاولة": "La vérification de la demande a expiré. Veuillez réessayer.",
  "انتهت مهلة قراءة طلب العملية؛ أعد المحاولة": "La réception de la demande a expiré. Veuillez réessayer.",
  "تكلفة الوحدة التي راجعتها يجب أن تكون رقمًا موجبًا صالحًا": "Le coût unitaire vérifié doit être un nombre positif valide.",
  "تغيرت الفاتورة أثناء مراجعة التكلفة؛ حدّث القائمة وأعد المحاولة": "La facture a changé pendant la vérification. Actualisez la liste puis réessayez.",
  "إعدادات صفحة مراجعة التكاليف غير صالحة": "Les paramètres de pagination de la vérification des coûts sont invalides.",
  "مراجعة تكاليف المبيعات متاحة للمالك فقط": "Seul le propriétaire peut vérifier les coûts de vente.",
  "اختر إجراء المراجعة واكتب سببًا واضحًا لا يتجاوز 1000 حرف": "Choisissez une action et indiquez un motif clair de 1000 caractères au maximum.",
  "السطر غير متاح لمراجعة التكلفة أو تمت مراجعته بالفعل": "Cette ligne n’est pas disponible ou a déjà été vérifiée.",
  "تغيرت الفاتورة أو مصدر التكلفة؛ حدّث قائمة المراجعة وأعد المحاولة": "La facture ou sa source de coût a changé. Actualisez la liste puis réessayez.",
  "بيانات مبلغ أو كمية البيع غير مكتملة؛ لا يمكن اعتماد التكلفة آليًا": "Le montant ou la quantité de vente est incomplet. Le coût ne peut pas être validé automatiquement.",
  "لا يوجد مصدر تكلفة تاريخي مؤكد لهذا السطر؛ لا يمكن تخمين التكلفة": "Cette ligne n’a aucune source de coût historique confirmée. Le coût ne peut pas être estimé.",
  "اسم فئة المصروف مطلوب ولا يتجاوز 80 حرفًا": "Le nom de la catégorie est requis (80 caractères maximum).",
  "فئة المصروف موجودة بالفعل": "Cette catégorie de dépense existe déjà.",
  "فئة المصروف غير صالحة": "Catégorie de dépense invalide.",
  "فئة المصروف غير موجودة": "Catégorie de dépense introuvable.",
  "اسم المستخدم غير صحيح": "Nom d’utilisateur incorrect",
  "كلمة المرور غير صحيحة": "Mot de passe incorrect",
  "طلب غير صالح": "Requête invalide",
  "تعذر تسجيل الدخول": "Connexion impossible",
  "تعذر تنفيذ العملية": "Impossible d’effectuer l’opération",
  "اسم الفئة مطلوب": "Le nom de la catégorie est obligatoire",
  "اسم الفئة طويل جدًا": "Le nom de la catégorie est trop long",
  "هذه الفئة موجودة بالفعل": "Cette catégorie existe déjà",
  "الفئة غير موجودة": "Catégorie introuvable",
  "رمز العملة يجب أن يتكون من 3 أحرف إنجليزية": "Le code de devise doit contenir exactement 3 lettres anglaises",
  "قائمة العملات غير صالحة": "La liste des devises n’est pas valide",
  "عدد العملات المحفوظة كبير جدًا": "Trop de devises enregistrées",
  "تعذر حفظ العملة": "Impossible d’enregistrer la devise",
};

export function translateApiError(locale: Locale, message: string): string {
  if (locale === "ar") return message;
  const exact = exactFrench[message];
  if (exact) return exact;
  const invalidHistory = message.match(/^لا يمكن إلغاء المستند (.+) \((.*)\): كمية السطر (\d+) غير صالحة؛ راجع بيانات السند الأصلي$/);
  if (invalidHistory) return `Impossible d’annuler le document ${invalidHistory[1]} (${invalidHistory[2]}) : quantité invalide à la ligne ${invalidHistory[3]}. Vérifiez le document d’origine.`;
  const invalidStock = message.match(/^رصيد المخزون المسجل للمنتج (.+) في المخزن (.+) غير صالح؛ راجع بيانات المخزون$/);
  if (invalidStock) return `Stock enregistré invalide pour le produit ${invalidStock[1]} dans l’entrepôt ${invalidStock[2]}. Vérifiez les données de stock.`;
  const invalidMovement = message.match(/^(كمية|ناتج) حركة المخزون في المستند (.+) غير (?:صالحة|صالح)؛ راجع بيانات المستند$/);
  if (invalidMovement) return `Mouvement de stock invalide pour le document ${invalidMovement[2]}. Vérifiez les données du document.`;
  const insufficientBalance = message.match(/^الرصيد غير كافٍ في (.+)$/);
  if (insufficientBalance) return `Solde insuffisant sur ${insufficientBalance[1]}`;
  const insufficientStock = message.match(/^المخزون غير كافٍ للمنتج (.+)$/);
  if (insufficientStock) return `Stock insuffisant pour ${insufficientStock[1]}`;
  console.error("Unmapped API error", message);
  return "Une erreur est survenue. Veuillez réessayer.";
}

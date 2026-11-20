import type { Locale } from "./locale";

const exactFrench: Record<string, string> = {
  "لا يمكن تعديل المصروف لأن وقت السند الأصلي غير صالح": "Impossible de modifier cette dépense : l’heure du document d’origine est invalide.",
  "وقت تسجيل المصروف غير صالح": "L’heure d’enregistrement de la dépense est invalide.",
  "اتجاه رصيد بداية العامل غير صالح": "Le sens du solde initial du salarié est invalide.",
  "يوجد أكثر من رصيد بداية معتمد للعامل": "Ce salarié possède plusieurs soldes initiaux validés.",
  "تاريخ الحركة يسبق رصيد بداية العامل؛ عدّل تاريخ رصيد البداية أولًا ثم أعد المحاولة": "Le mouvement précède le solde initial du salarié. Corrigez d’abord sa date, puis réessayez.",
  "اختر لنا أو علينا لرصيد بداية العامل": "Indiquez si le solde initial est à recevoir ou à payer au salarié.",
  "يوجد رصيد بداية معتمد للعامل؛ عدّله أو ألغِه أولًا": "Ce salarié possède déjà un solde initial. Modifiez-le ou annulez-le d’abord.",
  "تاريخ رصيد البداية يجب ألا يتجاوز اليوم أو أول حركة أو استحقاق للعامل": "La date du solde initial ne peut dépasser aujourd’hui, le premier mouvement ou le premier droit du salarié.",
  "ملاحظة رصيد البداية طويلة جدًا": "La note du solde initial est trop longue.",
  "تغير رصيد البداية أثناء العملية؛ حدّث الصفحة وأعد المحاولة": "Le solde initial a changé. Actualisez la page puis réessayez.",
  "بيانات رصيد بداية العامل غير صالحة": "Les données du solde initial du salarié sont invalides.",
  "رصيد بداية العامل غير موجود أو ملغى": "Le solde initial du salarié est introuvable ou déjà annulé.",
  "احذف آخر تصحيح لرصيد البداية أولًا ثم أعد محاولة حذف رصيد البداية الأصلي.": "Annulez d’abord la dernière correction du stock initial, puis réessayez d’annuler le stock initial.",
  "مجموع السطر غير صالح": "Le total de la ligne est invalide.",
  "مجموع السطر لا يطابق الكمية وسعر الوحدة": "Le total de la ligne ne correspond pas à la quantité et au prix unitaire.",
  "إجمالي الفاتورة غير صالح": "Le total de la facture est invalide.",
  "نمط مجموع سطر الفاتورة غير صالح": "Le mode de calcul du total de la ligne est invalide.",
  "قيم سطر الفاتورة الدقيق غير صالحة": "Les valeurs de la ligne à total précis sont invalides.",
  "إجمالي الفاتورة لا يطابق مجموع سطورها": "Le total de la facture ne correspond pas à la somme de ses lignes.",
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

const clearanceReasonsFrench: Record<string,string> = {
  "مرجع مجموعة التصفير غير صالح":"référence du groupe de mise à zéro invalide",
  "مرجع المنتج لا يطابق طلب الاستعادة":"le produit ne correspond pas à la demande de restauration",
  "تعذر تحديد السندات المرتبطة بمجموعة التصفير":"les documents du groupe ne peuvent pas être identifiés",
  "مجموعة التصفير تحتوي مرجع منتج آخر أو سندًا غير متطابق":"le groupe contient un autre produit ou un document incohérent",
  "مراجع سندات التصفير مفقودة أو مكررة":"références des documents manquantes ou dupliquées",
  "مراجع حركات التصفير مفقودة أو مكررة":"références des mouvements manquantes ou dupliquées",
  "سجل التصفير لا يحتوي مرجع منتج ومخزن وحيدًا ومتطابقًا":"le document ne désigne pas un produit et un entrepôt uniques et cohérents",
  "سند التصفير يحتوي أثرًا ماليًا لا يطابق الأرشفة":"le document contient un effet financier incompatible avec l’archivage",
  "كمية التصفير أو أرصدة السند غير متطابقة":"la quantité et les soldes du document sont incohérents",
  "السند معدل أو سبق عكسه ولا يمكن استعادته مرة أخرى":"le document a été modifié ou déjà annulé",
  "مجموعة التصفير تحتوي سندات متكررة للمخزن نفسه":"le groupe contient plusieurs documents pour le même entrepôt",
  "المخزن المرتبط بالتصفير غير موجود":"l’entrepôt du document est introuvable",
  "حركات المخزون لا تطابق سند التصفير أو تحتوي عكسًا سابقًا":"les mouvements de stock sont incohérents ou comportent une annulation antérieure",
  "الرصيد الحالي لا يسمح بعكس التصفير":"le stock actuel ne permet pas l’annulation",
  "الرصيد الحالي أو ناتج استعادة الكمية غير صالح":"le stock actuel ou le résultat de la restauration est invalide",
  "سندات التصفير القديمة لا تحدد مجموعة واحدة للمخزن بأمان":"les anciens documents ne permettent pas d’identifier un groupe unique par entrepôt",
  "تغير السند أثناء الاستعادة، أعد المحاولة":"le document a changé pendant la restauration, veuillez réessayer",
};

export function translateApiError(locale: Locale, message: string): string {
  if (locale === "ar") return message;
  const exact = exactFrench[message];
  if (exact) return exact;
  const clearance = message.match(/^لا يمكن عكس تصفير الأرشفة للسند (.+) \((.*)\) في المخزن (.+): (.+)$/);
  if (clearance) return `Impossible d’annuler la mise à zéro du document ${clearance[1]} (${clearance[2]}) dans l’entrepôt ${clearance[3]} : ${clearanceReasonsFrench[clearance[4]] ?? "les données du document doivent être vérifiées"}.`;
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

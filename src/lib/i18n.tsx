import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react'

const en = {
  appName: 'Naqd',
  // nav
  home: 'Home', ledger: 'Ledger', receivables: 'Receivables', newEntry: 'New entry', more: 'More',
  parties: 'People & companies', advances: 'Employee advances', statements: 'Statements', settings: 'Settings',
  // common
  save: 'Save', cancel: 'Cancel', add: 'Add', edit: 'Edit', void: 'Void', search: 'Search', loading: 'Loading…',
  offline: 'You are offline. Entries are saved on this device and sent when you reconnect.',
  pending: 'waiting to sync', syncNow: 'Sync now', date: 'Date', amount: 'Amount', note: 'Note', phone: 'Phone',
  name: 'Name', total: 'Total', back: 'Back', retry: 'Retry', discard: 'Discard', optional: 'optional',
  signOut: 'Sign out', language: 'Language', month: 'Month', receipt: 'Receipt', attachReceipt: 'Attach receipt photo',
  viewReceipt: 'View receipt', all: 'All', saveAndAnother: 'Save and add another', required: 'Required',
  // auth
  signIn: 'Sign in', signUp: 'Create account', email: 'Email', password: 'Password',
  haveAccount: 'Already have an account? Sign in', noAccount: 'New here? Create an account',
  checkEmail: 'Check your email to confirm your account, then sign in.',
  setupTitle: 'Set up your workspace', setupHint: 'This is the business whose cash you track.',
  workspaceName: 'Business name', yourName: 'Your name', createWorkspace: 'Create workspace',
  notConfigured: 'Supabase is not configured',
  notConfiguredHint: 'Copy .env.example to .env.local, add your Supabase URL and anon key, then restart the dev server.',
  // dashboard
  cashInHand: 'Cash in hand', receivablesTotal: 'Clients owe you', withEmployees: 'With employees',
  thisMonth: 'This month', sales: 'Billed to clients', cost: 'Cost of purchases', grossProfit: 'Gross profit',
  fuel: 'Fuel', transport: 'Transport', otherExpenses: 'Other expenses', netProfit: 'Net profit',
  withdrawn: 'Withdrawn from bank', topups: 'Received from funders', collected: 'Collected from clients',
  aging: 'Who owes you, by age', d0: '0–30 days', d31: '31–60', d61: '61–90', d90: '90+',
  nothingOwed: 'No client owes you anything right now.',
  startHere: 'Start here', startHint: 'Add your first client, then record a bank withdrawal and your first purchase.',
  addClient: 'Add a client', recent: 'Latest entries', seeAll: 'See all',
  // kinds
  purchase: 'Purchase for client', collection: 'Client payment', bank_withdrawal: 'Bank withdrawal', topup: 'Cash from funder',
  advance: 'Advance to employee', employee_return: 'Employee returned cash', advance_expense: 'Employee spent advance',
  fuel_k: 'Fuel', transport_k: 'Transport', expense: 'Other expense',
  purchase_h: 'You bought something and billed a client', collection_h: 'A client paid you',
  bank_withdrawal_h: 'Cash taken out of the bank', topup_h: 'A CEO or other person gave you cash',
  advance_h: 'You handed cash to an employee', employee_return_h: 'An employee gave cash back',
  advance_expense_h: 'An employee used advance money for a task', fuel_h: 'Fuel for a vehicle',
  transport_h: 'Taxi, parking, delivery, tolls', expense_h: 'Any other cash cost',
  gSales: 'Sales', gCash: 'Cash in', gEmployees: 'Employees', gCosts: 'Costs',
  whatHappened: 'What happened?',
  // fields
  client: 'Client', vendor: 'Bought from', description: 'What was bought', costPrice: 'Cost (what you paid)',
  profit: 'Your profit', sellingPrice: 'Billed to client', markupPct: 'Markup %', profitAmount: 'Amount',
  paymentMode: 'How did they pay?', cash: 'Cash', transfer: 'Bank transfer', cheque: 'Cheque',
  cashNote: 'Only cash payments change your cash in hand.',
  employee: 'Employee', funder: 'Funder (CEO / other)', vehicle: 'Vehicle', km: 'Distance (km)', linkedClient: 'For client',
  addNew: '+ Add new', newName: 'Name', chooseOne: 'Choose…',
  // messages
  saved: 'Saved', savedOffline: 'Saved on this device. It will sync when you are online.',
  invalidAmount: 'Enter a valid amount, for example 1250.50', chooseParty: 'Choose who this is for',
  needCost: 'Enter what you paid', voidReason: 'Why are you voiding this?', voided: 'Voided',
  confirmVoid: 'Void this entry? It stays in the audit log but no longer counts.', voidedTag: 'voided',
  voice: 'by voice', noCashTag: 'no cash moved',
  // parties
  clients: 'Clients', employees: 'Employees', funders: 'Funders', vendors: 'Vendors',
  billed: 'Billed', paid: 'Paid', owes: 'Owes', advanced: 'Given', returned: 'Returned', spent: 'Spent', holding: 'Holding',
  received: 'Received', noPartiesYet: 'Nothing here yet.', history: 'History', balance: 'Balance',
  deactivate: 'Hide', activate: 'Show', showHidden: 'Show hidden', giveAdvance: 'Give advance',
  delete: 'Delete', deleted: 'Deleted', confirmDelete: 'Delete "{name}"? This cannot be undone.',
  cannotDelete: 'This name has entries, so it cannot be deleted. Use Hide to remove it from lists.',
  boughtHere: 'Purchases from this vendor',
  // statements
  statement: 'Statement of account', chooseClient: 'Choose a client', openingBalance: 'Balance brought forward',
  purchasesInMonth: 'Purchases', paymentsInMonth: 'Payments received', closingBalance: 'Amount due',
  printPdf: 'Print / save as PDF', copyText: 'Copy for WhatsApp', downloadCsv: 'Download CSV', copied: 'Copied',
  statementFoot: 'Please settle the amount due at your earliest convenience.', noActivity: 'No activity this month.',
  preparedFor: 'Prepared for',
  // settings
  workspace: 'Workspace', backup: 'Backup', exportBackup: 'Download full backup (JSON)',
  backupHint: 'Free plans have limited backups. Download one regularly.',
  syncQueue: 'Waiting on this device', rejected: 'Rejected by the server',
  none: 'Nothing waiting.', ledgerFilter: 'Filter', allKinds: 'All entries',
  runningLow: 'Cash in hand is negative. Check your entries or add a bank withdrawal.',
}
export type Key = keyof typeof en

const ar: Record<Key, string> = {
  appName: 'نقد',
  home: 'الرئيسية', ledger: 'السجل', receivables: 'المستحقات', newEntry: 'قيد جديد', more: 'المزيد',
  parties: 'الأشخاص والشركات', advances: 'سُلف الموظفين', statements: 'كشوف الحساب', settings: 'الإعدادات',
  save: 'حفظ', cancel: 'إلغاء', add: 'إضافة', edit: 'تعديل', void: 'إلغاء القيد', search: 'بحث', loading: 'جارٍ التحميل…',
  offline: 'أنت غير متصل. تُحفظ القيود على هذا الجهاز وتُرسل عند عودة الاتصال.',
  pending: 'بانتظار المزامنة', syncNow: 'مزامنة الآن', date: 'التاريخ', amount: 'المبلغ', note: 'ملاحظة', phone: 'الجوال',
  name: 'الاسم', total: 'الإجمالي', back: 'رجوع', retry: 'إعادة المحاولة', discard: 'حذف من الانتظار', optional: 'اختياري',
  signOut: 'تسجيل الخروج', language: 'اللغة', month: 'الشهر', receipt: 'الإيصال', attachReceipt: 'إرفاق صورة الإيصال',
  viewReceipt: 'عرض الإيصال', all: 'الكل', saveAndAnother: 'حفظ وإضافة آخر', required: 'مطلوب',
  signIn: 'تسجيل الدخول', signUp: 'إنشاء حساب', email: 'البريد الإلكتروني', password: 'كلمة المرور',
  haveAccount: 'لديك حساب؟ سجّل الدخول', noAccount: 'مستخدم جديد؟ أنشئ حساباً',
  checkEmail: 'تحقق من بريدك لتأكيد الحساب ثم سجّل الدخول.',
  setupTitle: 'إعداد مساحة العمل', setupHint: 'هذه هي الجهة التي تتابع نقدها.',
  workspaceName: 'اسم النشاط', yourName: 'اسمك', createWorkspace: 'إنشاء مساحة العمل',
  notConfigured: 'لم يتم ضبط Supabase',
  notConfiguredHint: 'انسخ ‎.env.example إلى ‎.env.local وأضف رابط Supabase والمفتاح ثم أعد تشغيل الخادم.',
  cashInHand: 'النقد بيدك', receivablesTotal: 'المستحق على العملاء', withEmployees: 'مع الموظفين',
  thisMonth: 'هذا الشهر', sales: 'المفوتر للعملاء', cost: 'تكلفة المشتريات', grossProfit: 'الربح الإجمالي',
  fuel: 'الوقود', transport: 'المواصلات', otherExpenses: 'مصروفات أخرى', netProfit: 'صافي الربح',
  withdrawn: 'المسحوب من البنك', topups: 'المستلم من الممولين', collected: 'المحصّل من العملاء',
  aging: 'من عليه مبالغ، حسب العمر', d0: '٠–٣٠ يوماً', d31: '٣١–٦٠', d61: '٦١–٩٠', d90: '+٩٠',
  nothingOwed: 'لا يوجد مبالغ مستحقة على العملاء حالياً.',
  startHere: 'ابدأ من هنا', startHint: 'أضف أول عميل، ثم سجّل سحباً من البنك وأول عملية شراء.',
  addClient: 'إضافة عميل', recent: 'آخر القيود', seeAll: 'عرض الكل',
  purchase: 'شراء لعميل', collection: 'دفعة من عميل', bank_withdrawal: 'سحب من البنك', topup: 'نقد من ممول',
  advance: 'سلفة لموظف', employee_return: 'موظف أعاد نقداً', advance_expense: 'موظف صرف من السلفة',
  fuel_k: 'وقود', transport_k: 'مواصلات', expense: 'مصروف آخر',
  purchase_h: 'اشتريت شيئاً وفوترته على عميل', collection_h: 'عميل دفع لك',
  bank_withdrawal_h: 'نقد سُحب من البنك', topup_h: 'مدير أو شخص آخر أعطاك نقداً',
  advance_h: 'سلّمت نقداً لموظف', employee_return_h: 'موظف أعاد لك نقداً',
  advance_expense_h: 'موظف استخدم مبلغ السلفة في مهمة', fuel_h: 'وقود لمركبة',
  transport_h: 'أجرة، موقف، توصيل، رسوم', expense_h: 'أي تكلفة نقدية أخرى',
  gSales: 'المبيعات', gCash: 'نقد وارد', gEmployees: 'الموظفون', gCosts: 'التكاليف',
  whatHappened: 'ماذا حدث؟',
  client: 'العميل', vendor: 'اشتريت من', description: 'ما الذي تم شراؤه', costPrice: 'التكلفة (ما دفعته)',
  profit: 'ربحك', sellingPrice: 'المفوتر للعميل', markupPct: 'نسبة الربح %', profitAmount: 'المبلغ',
  paymentMode: 'كيف دفع؟', cash: 'نقداً', transfer: 'تحويل بنكي', cheque: 'شيك',
  cashNote: 'الدفعات النقدية فقط تغيّر النقد الذي بيدك.',
  employee: 'الموظف', funder: 'الممول (مدير / آخر)', vehicle: 'المركبة', km: 'المسافة (كم)', linkedClient: 'لأجل عميل',
  addNew: '+ إضافة جديد', newName: 'الاسم', chooseOne: 'اختر…',
  saved: 'تم الحفظ', savedOffline: 'حُفظ على هذا الجهاز وسيُرسل عند عودة الاتصال.',
  invalidAmount: 'أدخل مبلغاً صحيحاً، مثل 1250.50', chooseParty: 'اختر الجهة',
  needCost: 'أدخل ما دفعته', voidReason: 'لماذا تلغي هذا القيد؟', voided: 'تم الإلغاء',
  confirmVoid: 'إلغاء هذا القيد؟ يبقى في سجل التدقيق لكنه لا يُحتسب.', voidedTag: 'ملغي',
  voice: 'بالصوت', noCashTag: 'بدون حركة نقد',
  clients: 'العملاء', employees: 'الموظفون', funders: 'الممولون', vendors: 'الموردون',
  billed: 'المفوتر', paid: 'المدفوع', owes: 'عليه', advanced: 'المُعطى', returned: 'المُعاد', spent: 'المصروف', holding: 'بحوزته',
  received: 'المستلم', noPartiesYet: 'لا يوجد شيء بعد.', history: 'السجل', balance: 'الرصيد',
  deactivate: 'إخفاء', activate: 'إظهار', showHidden: 'إظهار المخفي', giveAdvance: 'إعطاء سلفة',
  delete: 'حذف', deleted: 'تم الحذف', confirmDelete: 'حذف "{name}"؟ لا يمكن التراجع عن ذلك.',
  cannotDelete: 'لهذا الاسم قيود، لذا لا يمكن حذفه. استخدم الإخفاء لإزالته من القوائم.',
  boughtHere: 'المشتريات من هذا المورد',
  statement: 'كشف حساب', chooseClient: 'اختر عميلاً', openingBalance: 'الرصيد المرحّل',
  purchasesInMonth: 'المشتريات', paymentsInMonth: 'الدفعات المستلمة', closingBalance: 'المبلغ المستحق',
  printPdf: 'طباعة / حفظ PDF', copyText: 'نسخ لواتساب', downloadCsv: 'تنزيل CSV', copied: 'تم النسخ',
  statementFoot: 'نأمل سداد المبلغ المستحق في أقرب وقت.', noActivity: 'لا توجد حركة هذا الشهر.',
  preparedFor: 'أُعد لـ',
  workspace: 'مساحة العمل', backup: 'النسخ الاحتياطي', exportBackup: 'تنزيل نسخة احتياطية كاملة (JSON)',
  backupHint: 'الخطط المجانية لا توفر نسخاً احتياطية كافية. نزّل نسخة بانتظام.',
  syncQueue: 'بانتظار الإرسال من هذا الجهاز', rejected: 'رفضها الخادم',
  none: 'لا شيء بالانتظار.', ledgerFilter: 'تصفية', allKinds: 'كل القيود',
  runningLow: 'النقد بيدك بالسالب. راجع القيود أو أضف سحباً من البنك.',
}

type Lang = 'en' | 'ar'
interface Ctx { lang: Lang; setLang: (l: Lang) => void; t: (k: Key) => string; dir: 'ltr' | 'rtl'; kind: (k: string) => string }
const I18n = createContext<Ctx>(null as any)
export const useT = () => useContext(I18n)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('naqd:lang') as Lang) || 'en')
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  useEffect(() => {
    localStorage.setItem('naqd:lang', lang)
    document.documentElement.lang = lang
    document.documentElement.dir = dir
  }, [lang, dir])
  const value = useMemo<Ctx>(() => {
    const dict = lang === 'ar' ? ar : en
    const t = (k: Key) => dict[k] ?? en[k] ?? k
    const kind = (k: string) => t((k === 'fuel' ? 'fuel_k' : k === 'transport' ? 'transport_k' : k) as Key)
    return { lang, setLang, t, dir, kind }
  }, [lang, dir])
  return <I18n.Provider value={value}>{children}</I18n.Provider>
}

import type { SupportedLocale } from '../config';
import { formatFailureSummary } from './failureMessages';

const en = {
  directMapping: 'The service must be a direct mapping for visual editing.',
  invalidYaml: 'The service YAML is invalid. Correct it before switching to visual editing.',
  invalidEnvKey: 'Invalid environment key: "{key}".',
  duplicateEnvKeys: 'Environment keys must be unique.',
  staleDraft: 'The visual service draft no longer matches its source.',
  advancedField: 'The "{field}" field uses an advanced form; edit it in YAML instead.',
  invalidDependencies: 'Dependencies must have valid, unique service names.',
  missingBuildContext: 'A build context is required when a Dockerfile is specified.',
  advancedBuild: 'The build configuration has advanced fields; remove it in YAML instead.',
};

export type ComposeVisualMessageKey = keyof typeof en;
type Messages = { [K in ComposeVisualMessageKey]: string };

const translations: Record<SupportedLocale, Messages> = {
  en,
  'pt-BR': {
    directMapping: 'O serviço precisa ser um mapeamento direto para edição visual.',
    invalidYaml: 'O YAML do serviço é inválido. Corrija-o antes de voltar à edição visual.',
    invalidEnvKey: 'Chave de ambiente inválida: "{key}".',
    duplicateEnvKeys: 'As chaves de ambiente não podem se repetir.',
    staleDraft: 'O rascunho visual do serviço não corresponde mais ao arquivo de origem.',
    advancedField: 'O campo "{field}" usa uma sintaxe avançada; edite-o no YAML.',
    invalidDependencies: 'As dependências devem ter nomes de serviço válidos e únicos.',
    missingBuildContext: 'Informe um contexto de build ao especificar um Dockerfile.',
    advancedBuild: 'O build tem campos avançados; remova-o pelo YAML.',
  },
  es: {
    directMapping: 'El servicio debe ser un mapa directo para editarlo visualmente.',
    invalidYaml: 'El YAML del servicio no es válido. Corrígelo antes de cambiar al editor visual.',
    invalidEnvKey: 'Clave de entorno no válida: "{key}".',
    duplicateEnvKeys: 'Las claves de entorno deben ser únicas.',
    staleDraft: 'El borrador visual del servicio ya no coincide con su origen.',
    advancedField: 'El campo "{field}" usa una sintaxis avanzada; edítalo en YAML.',
    invalidDependencies: 'Las dependencias deben tener nombres de servicio válidos y únicos.',
    missingBuildContext: 'Se necesita un contexto de compilación al indicar un Dockerfile.',
    advancedBuild: 'La configuración de compilación tiene campos avanzados; elimínala en YAML.',
  },
  fr: {
    directMapping: 'Le service doit être une correspondance directe pour l’édition visuelle.',
    invalidYaml: 'Le YAML du service est invalide. Corrigez-le avant de revenir à l’édition visuelle.',
    invalidEnvKey: 'Clé d’environnement invalide : « {key} ».',
    duplicateEnvKeys: 'Les clés d’environnement doivent être uniques.',
    staleDraft: 'Le brouillon visuel du service ne correspond plus à sa source.',
    advancedField: 'Le champ « {field} » utilise une forme avancée ; modifiez-le en YAML.',
    invalidDependencies: 'Les dépendances doivent avoir des noms de service valides et uniques.',
    missingBuildContext: 'Un contexte de construction est requis lorsqu’un Dockerfile est indiqué.',
    advancedBuild: 'La configuration de construction comporte des champs avancés ; supprimez-la en YAML.',
  },
  de: {
    directMapping: 'Für die visuelle Bearbeitung muss der Dienst eine direkte Zuordnung sein.',
    invalidYaml: 'Das YAML des Dienstes ist ungültig. Korrigieren Sie es vor der visuellen Bearbeitung.',
    invalidEnvKey: 'Ungültiger Umgebungsschlüssel: „{key}“.',
    duplicateEnvKeys: 'Umgebungsschlüssel müssen eindeutig sein.',
    staleDraft: 'Der visuelle Dienstentwurf stimmt nicht mehr mit seiner Quelle überein.',
    advancedField: 'Das Feld „{field}“ verwendet eine erweiterte Form; bearbeiten Sie es in YAML.',
    invalidDependencies: 'Abhängigkeiten müssen gültige, eindeutige Dienstnamen haben.',
    missingBuildContext: 'Wenn ein Dockerfile angegeben wird, ist ein Build-Kontext erforderlich.',
    advancedBuild: 'Die Build-Konfiguration enthält erweiterte Felder; entfernen Sie sie in YAML.',
  },
  it: {
    directMapping: 'Il servizio deve essere una mappa diretta per la modifica visuale.',
    invalidYaml: 'Il YAML del servizio non è valido. Correggilo prima di tornare alla modifica visuale.',
    invalidEnvKey: 'Chiave d’ambiente non valida: "{key}".',
    duplicateEnvKeys: 'Le chiavi d’ambiente devono essere univoche.',
    staleDraft: 'La bozza visuale del servizio non corrisponde più alla sua origine.',
    advancedField: 'Il campo "{field}" usa una forma avanzata; modificalo in YAML.',
    invalidDependencies: 'Le dipendenze devono avere nomi di servizio validi e univoci.',
    missingBuildContext: 'È richiesto un contesto di build quando si specifica un Dockerfile.',
    advancedBuild: 'La configurazione di build contiene campi avanzati; rimuovila in YAML.',
  },
  ru: {
    directMapping: 'Для визуального редактирования сервис должен быть прямым отображением.',
    invalidYaml: 'YAML сервиса содержит ошибку. Исправьте её перед переходом к визуальному редактированию.',
    invalidEnvKey: 'Недопустимый ключ окружения: «{key}».',
    duplicateEnvKeys: 'Ключи окружения должны быть уникальными.',
    staleDraft: 'Визуальный черновик сервиса больше не соответствует источнику.',
    advancedField: 'Поле «{field}» имеет расширенный формат; измените его в YAML.',
    invalidDependencies: 'Зависимости должны иметь допустимые уникальные имена сервисов.',
    missingBuildContext: 'При указании Dockerfile требуется контекст сборки.',
    advancedBuild: 'Конфигурация сборки содержит расширенные поля; удалите её в YAML.',
  },
  uk: {
    directMapping: 'Для візуального редагування сервіс має бути прямим відображенням.',
    invalidYaml: 'YAML сервісу містить помилку. Виправте її перед переходом до візуального редагування.',
    invalidEnvKey: 'Неприпустимий ключ середовища: «{key}».',
    duplicateEnvKeys: 'Ключі середовища мають бути унікальними.',
    staleDraft: 'Візуальна чернетка сервісу більше не відповідає джерелу.',
    advancedField: 'Поле «{field}» має розширений формат; змініть його в YAML.',
    invalidDependencies: 'Залежності мають містити припустимі унікальні назви сервісів.',
    missingBuildContext: 'Якщо вказано Dockerfile, потрібен контекст збірки.',
    advancedBuild: 'Конфігурація збірки містить розширені поля; видаліть її в YAML.',
  },
  pl: {
    directMapping: 'Usługa musi być bezpośrednim mapowaniem, aby można ją było edytować wizualnie.',
    invalidYaml: 'YAML usługi jest nieprawidłowy. Popraw go przed przejściem do edycji wizualnej.',
    invalidEnvKey: 'Nieprawidłowy klucz środowiska: „{key}”.',
    duplicateEnvKeys: 'Klucze środowiska muszą być unikalne.',
    staleDraft: 'Wizualna wersja robocza usługi nie odpowiada już źródłu.',
    advancedField: 'Pole „{field}” ma zaawansowaną postać; edytuj je w YAML.',
    invalidDependencies: 'Zależności muszą mieć prawidłowe, unikalne nazwy usług.',
    missingBuildContext: 'Po wskazaniu Dockerfile wymagany jest kontekst budowania.',
    advancedBuild: 'Konfiguracja budowania zawiera zaawansowane pola; usuń ją w YAML.',
  },
  tr: {
    directMapping: 'Görsel düzenleme için hizmet doğrudan bir eşleme olmalıdır.',
    invalidYaml: 'Hizmetin YAML içeriği geçersiz. Görsel düzenlemeye geçmeden önce düzeltin.',
    invalidEnvKey: 'Geçersiz ortam anahtarı: "{key}".',
    duplicateEnvKeys: 'Ortam anahtarları benzersiz olmalıdır.',
    staleDraft: 'Görsel hizmet taslağı artık kaynağıyla eşleşmiyor.',
    advancedField: '"{field}" alanı gelişmiş bir biçim kullanıyor; YAML içinde düzenleyin.',
    invalidDependencies: 'Bağımlılıklar geçerli ve benzersiz hizmet adlarına sahip olmalıdır.',
    missingBuildContext: 'Dockerfile belirtildiğinde bir derleme bağlamı gereklidir.',
    advancedBuild: 'Derleme yapılandırmasında gelişmiş alanlar var; YAML içinde kaldırın.',
  },
  nl: {
    directMapping: 'De service moet een directe mapping zijn voor visuele bewerking.',
    invalidYaml: 'De YAML van de service is ongeldig. Corrigeer deze voordat u visueel bewerkt.',
    invalidEnvKey: 'Ongeldige omgevingssleutel: "{key}".',
    duplicateEnvKeys: 'Omgevingssleutels moeten uniek zijn.',
    staleDraft: 'Het visuele serviceconcept komt niet meer overeen met de bron.',
    advancedField: 'Het veld "{field}" gebruikt een geavanceerde vorm; bewerk het in YAML.',
    invalidDependencies: 'Afhankelijkheden moeten geldige, unieke servicenamen hebben.',
    missingBuildContext: 'Een buildcontext is vereist wanneer een Dockerfile is opgegeven.',
    advancedBuild: 'De buildconfiguratie bevat geavanceerde velden; verwijder deze in YAML.',
  },
  ja: {
    directMapping: 'ビジュアル編集にはサービスが直接マッピングである必要があります。',
    invalidYaml: 'サービスの YAML が無効です。ビジュアル編集に切り替える前に修正してください。',
    invalidEnvKey: '環境キーが無効です:「{key}」。',
    duplicateEnvKeys: '環境キーは重複できません。',
    staleDraft: 'サービスのビジュアル下書きが元の内容と一致しなくなりました。',
    advancedField: '「{field}」は高度な形式です。YAML で編集してください。',
    invalidDependencies: '依存関係には有効で重複しないサービス名を指定してください。',
    missingBuildContext: 'Dockerfile を指定する場合、ビルドコンテキストが必要です。',
    advancedBuild: 'ビルド構成に高度な項目があります。YAML で削除してください。',
  },
  ko: {
    directMapping: '시각적 편집을 사용하려면 서비스가 직접 매핑이어야 합니다.',
    invalidYaml: '서비스 YAML이 올바르지 않습니다. 시각적 편집으로 전환하기 전에 수정하세요.',
    invalidEnvKey: '올바르지 않은 환경 키: "{key}".',
    duplicateEnvKeys: '환경 키는 중복될 수 없습니다.',
    staleDraft: '서비스 시각적 초안이 더 이상 원본과 일치하지 않습니다.',
    advancedField: '"{field}" 필드는 고급 형식입니다. YAML에서 편집하세요.',
    invalidDependencies: '종속성에는 올바르고 고유한 서비스 이름이 필요합니다.',
    missingBuildContext: 'Dockerfile을 지정하면 빌드 컨텍스트가 필요합니다.',
    advancedBuild: '빌드 구성에 고급 필드가 있습니다. YAML에서 제거하세요.',
  },
  'zh-CN': {
    directMapping: '服务必须是直接映射才能进行可视化编辑。',
    invalidYaml: '服务的 YAML 无效。切换到可视化编辑前请先修正。',
    invalidEnvKey: '环境变量键无效：“{key}”。',
    duplicateEnvKeys: '环境变量键不能重复。',
    staleDraft: '服务的可视化草稿已不再与源文件匹配。',
    advancedField: '“{field}”字段使用高级格式；请在 YAML 中编辑。',
    invalidDependencies: '依赖项必须使用有效且唯一的服务名称。',
    missingBuildContext: '指定 Dockerfile 时必须提供构建上下文。',
    advancedBuild: '构建配置包含高级字段；请在 YAML 中删除。',
  },
  'zh-TW': {
    directMapping: '服務必須是直接對應才能進行視覺化編輯。',
    invalidYaml: '服務的 YAML 無效。切換至視覺化編輯前請先修正。',
    invalidEnvKey: '環境變數鍵無效：「{key}」。',
    duplicateEnvKeys: '環境變數鍵不可重複。',
    staleDraft: '服務的視覺化草稿已不再符合來源。',
    advancedField: '「{field}」欄位使用進階格式；請在 YAML 中編輯。',
    invalidDependencies: '相依項目必須使用有效且唯一的服務名稱。',
    missingBuildContext: '指定 Dockerfile 時必須提供建置內容。',
    advancedBuild: '建置設定包含進階欄位；請在 YAML 中移除。',
  },
  hi: {
    directMapping: 'दृश्य संपादन के लिए सेवा का सीधा मैपिंग होना आवश्यक है।',
    invalidYaml: 'सेवा का YAML अमान्य है। दृश्य संपादन पर जाने से पहले इसे ठीक करें।',
    invalidEnvKey: 'अमान्य परिवेश कुंजी: "{key}"।',
    duplicateEnvKeys: 'परिवेश कुंजियाँ अद्वितीय होनी चाहिए।',
    staleDraft: 'सेवा का दृश्य ड्राफ़्ट अब उसके स्रोत से मेल नहीं खाता।',
    advancedField: '"{field}" फ़ील्ड उन्नत रूप में है; इसे YAML में संपादित करें।',
    invalidDependencies: 'निर्भरताओं में मान्य और अद्वितीय सेवा नाम होने चाहिए।',
    missingBuildContext: 'Dockerfile निर्दिष्ट करने पर बिल्ड कॉन्टेक्स्ट आवश्यक है।',
    advancedBuild: 'बिल्ड कॉन्फ़िगरेशन में उन्नत फ़ील्ड हैं; इसे YAML में हटाएँ।',
  },
};

export function formatComposeVisualMessage(
  locale: SupportedLocale,
  key: ComposeVisualMessageKey,
  variables: Record<string, string> = {}
): string {
  return translations[locale][key].replace(/\{(\w+)\}/g, (match, name: string) =>
    variables[name] ?? match
  );
}

export class ComposeVisualError extends Error {
  constructor(
    public readonly key: ComposeVisualMessageKey,
    public readonly variables: Record<string, string> = {},
    public readonly details?: string
  ) {
    super(formatComposeVisualMessage('en', key, variables));
    this.name = 'ComposeVisualError';
  }
}

export function describeComposeVisualError(
  locale: SupportedLocale,
  error: Error | string
): { summary: string; details: string } {
  const details = error instanceof ComposeVisualError && error.details
    ? error.details : error instanceof Error ? error.message : error;
  return {
    summary: error instanceof ComposeVisualError
      ? formatComposeVisualMessage(locale, error.key, error.variables)
      : formatFailureSummary(locale, { kind: 'generic' }),
    details,
  };
}

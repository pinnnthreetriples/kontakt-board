import type { ImportColumnMapping } from '../../../shared/model/domain';

// Пустой список алиасов = поле не подставляется само, только вручную в мастере импорта.
// Цвет тегам заводится при импорте, поэтому автоподстановка «Теги» безопасна.
const HEADER_ALIASES: Record<keyof ImportColumnMapping, string[]> = {
  organization: ['организация', 'компания', 'название организации'],
  taxId: ['инн'],
  personName: ['контакт', 'контактное лицо', 'фио', 'имя'],
  position: ['должность'],
  phone: ['телефон', 'телефон 1', 'номер телефона'],
  secondaryPhone: ['телефон 2', 'дополнительный телефон'],
  email: ['e-mail', 'email', 'почта'],
  address: ['адрес'],
  region: ['регион'],
  website: ['сайт'],
  tags: ['теги', 'тег'],
  externalId: ['id записи', 'id', 'ид записи'],
  result: ['результат', 'статус'],
  description: ['комментарий', 'описание', 'описание сферы деятельности'],
  assignee: ['сотрудник', 'ответственный'],
  source: ['источник'],
  createdAt: ['дата', 'дата заявки', 'создано'],
  initialComment: [],
};

// Сначала точные совпадения, потом заголовки с уточнением после названия поля
// («Телефон, на который звонили»). Каждый столбец достаётся только одному полю.
export function suggestMapping(headers: string[]): ImportColumnMapping {
  const mapping: ImportColumnMapping = {};
  const claimed = new Set<string>();
  const fields = Object.entries(HEADER_ALIASES) as Array<[keyof ImportColumnMapping, string[]]>;
  const pick = (matches: (key: string) => boolean): string | undefined =>
    headers.find((header) => !claimed.has(header) && matches(header.trim().toLowerCase()));
  for (const [field, aliases] of fields) {
    const header = pick((key) => aliases.includes(key));
    if (header) { mapping[field] = header; claimed.add(header); }
  }
  for (const [field, aliases] of fields) {
    if (mapping[field]) continue;
    const header = pick((key) => aliases.some((alias) => key.startsWith(alias)));
    if (header) { mapping[field] = header; claimed.add(header); }
  }
  // Второй телефонный столбец уходит в дополнительный телефон, но только когда основной
  // уже нашёлся: если в файле телефон один, он обязан остаться основным.
  if (mapping.phone && !mapping.secondaryPhone) {
    const header = pick((key) => key.startsWith('телефон'));
    if (header) { mapping.secondaryPhone = header; claimed.add(header); }
  }
  return mapping;
}

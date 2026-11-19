const MAX_SOURCE_LENGTH = 20000;
const MAX_COMMANDS = 100;
const PROPERTY_ALLOWLIST = new Set([
  'visible', 'backgroundColor3', 'backgroundTransparency', 'opacity',
  'text', 'textColor3', 'textTransparency', 'textSize', 'rotation',
  'zIndex', 'blur', 'saturation', 'brightness',
  'contrast', 'tintColor', 'tintOpacity', 'enabled'
]);

const parseString = value => {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'string' ? parsed : null;
  } catch { return null; }
};

export function parseFlowScript(source) {
  const text = String(source ?? '');
  if (text.length > MAX_SOURCE_LENGTH) throw new Error('O script ultrapassa o limite de 20.000 caracteres.');
  const lines = text.split(/\r?\n/);
  if (lines.length > 300) throw new Error('O script ultrapassa o limite de 300 linhas.');
  const meaningful = lines.map((raw, index) => ({ raw: raw.trim(), line: index + 1 }))
    .filter(item => item.raw && !item.raw.startsWith('//'));
  if (!meaningful.length) return { event: 'click', commands: [] };
  const header = meaningful.shift();
  if (!/^on\(\s*"(?:click|Activated)"\s*,\s*\(\)\s*=>\s*\{\s*$/.test(header.raw)) {
    throw new Error('Linha ' + header.line + ': comece com on("click", () => {');
  }
  const closing = meaningful.pop();
  if (!closing || closing.raw !== '});') throw new Error('Finalize o evento com });');
  const commands = [];
  for (const item of meaningful) {
    const line = item.raw.endsWith(';') ? item.raw.slice(0, -1).trim() : item.raw;
    let match;
    if ((match = line.match(/^(show|hide)\(\s*("(?:[^"\\\\]|\\\\.)*")\s*\)$/))) {
      const target = parseString(match[2]);
      if (target === null) throw new Error('Linha ' + item.line + ': nome de objeto inválido.');
      commands.push({ type: match[1], target });
    } else if ((match = line.match(/^setVisible\(\s*("(?:[^"\\\\]|\\\\.)*")\s*,\s*(true|false)\s*\)$/))) {
      const target = parseString(match[1]);
      commands.push({ type: 'setVisible', target, value: match[2] === 'true' });
    } else if ((match = line.match(/^setText\(\s*("(?:[^"\\\\]|\\\\.)*")\s*,\s*("(?:[^"\\\\]|\\\\.)*")\s*\)$/))) {
      const target = parseString(match[1]), value = parseString(match[2]);
      if (target === null || value === null) throw new Error('Linha ' + item.line + ': texto inválido.');
      commands.push({ type: 'setText', target, value: value.slice(0, 2000) });
    } else if ((match = line.match(/^setProperty\(\s*("(?:[^"\\\\]|\\\\.)*")\s*,\s*("(?:[^"\\\\]|\\\\.)*")\s*,\s*(.+)\)$/))) {
      const target = parseString(match[1]), property = parseString(match[2]);
      let value;
      try { value = JSON.parse(match[3]); } catch { throw new Error('Linha ' + item.line + ': use um valor de texto, número ou booleano válido.'); }
      if (target === null || property === null || !PROPERTY_ALLOWLIST.has(property) ||
          !['string', 'number', 'boolean'].includes(typeof value) ||
          (typeof value === 'number' && !Number.isFinite(value))) {
        throw new Error('Linha ' + item.line + ': propriedade ou valor não permitido.');
      }
      commands.push({ type: 'setProperty', target, property, value });
    } else if ((match = line.match(/^print\(\s*("(?:[^"\\\\]|\\\\.)*")\s*\)$/))) {
      const value = parseString(match[1]);
      if (value === null) throw new Error('Linha ' + item.line + ': mensagem inválida.');
      commands.push({ type: 'print', value: value.slice(0, 300) });
    } else {
      throw new Error('Linha ' + item.line + ': comando não reconhecido. Consulte a ajuda do FlowScript.');
    }
    if (commands.length > MAX_COMMANDS) throw new Error('O script ultrapassa o limite de 100 comandos.');
  }
  return { event: 'click', commands };
}

// Property schema registry for the Inspector.
// Keep property definitions separate from rendering so classes can add or override
// categories without coupling the data model to DOM controls.
const registry = new Map();

const number = (key, label, min, max, step = 1) => ({ key, label, type: 'number', min, max, step });
const slider = (key, label, min, max, step = 0.01) => ({ key, label, type: 'slider', min, max, step });
const udim2 = (key, label, subgroup) => ({ key, label, type: 'udim2', subgroup, components: 4 });
const vector2 = (key, label, subgroup) => ({ key, label, type: 'vector2', subgroup, components: 2 });
const text = (key, label) => ({ key, label, type: 'text' });
const color = (key, label) => ({ key, label, type: 'color' });
const select = (key, label, values) => ({ key, label, type: 'select', values });
const checkbox = (key, label) => ({ key, label, type: 'checkbox' });

const layout = [
  { title: 'Position · UDim2', fields: [
    { ...number('position.x.scale', 'X · Scale', -10, 10, 0.01), subgroup: 'Position' },
    { ...number('position.x.offset', 'X · Offset', -4000, 4000), subgroup: 'Position' },
    { ...number('position.y.scale', 'Y · Scale', -10, 10, 0.01), subgroup: 'Position' },
    { ...number('position.y.offset', 'Y · Offset', -4000, 4000), subgroup: 'Position' }
  ]},
  { title: 'Size · UDim2', fields: [
    { ...number('size.x.scale', 'X · Scale', -10, 10, 0.01), subgroup: 'Size' },
    { ...number('size.x.offset', 'X · Offset', 1, 4000), subgroup: 'Size' },
    { ...number('size.y.scale', 'Y · Scale', -10, 10, 0.01), subgroup: 'Size' },
    { ...number('size.y.offset', 'Y · Offset', 1, 4000), subgroup: 'Size' }
  ]},
  { title: 'AnchorPoint', fields: [
    { ...number('anchorPoint.x', 'X', 0, 1, 0.01), subgroup: 'AnchorPoint' },
    { ...number('anchorPoint.y', 'Y', 0, 1, 0.01), subgroup: 'AnchorPoint' }
  ]}
];

const appearance = [
  color('background', 'Fundo'),
  color('border', 'Borda'),
  number('borderWidth', 'Espessura da borda', 0, 30),
  number('radius', 'Arredondamento', 0, 120),
  slider('opacity', 'Opacidade', 0, 1, 0.01),
  slider('rotation', 'Rotação', -360, 360, 1),
  checkbox('visible', 'Visível')
];

const textAppearance = [
  color('color', 'Cor do texto'),
  text('text', 'Texto'),
  number('fontSize', 'Tamanho do texto', 8, 120),
  select('textAlign', 'Alinhamento do texto', [
    { value: 'left', label: 'Esquerda' },
    { value: 'center', label: 'Centro' },
    { value: 'right', label: 'Direita' }
  ]),
  select('fontWeight', 'Peso do texto', [
    { value: '400', label: 'Normal' },
    { value: '500', label: 'Médio' },
    { value: '600', label: 'Seminegrito' },
    { value: '700', label: 'Negrito' }
  ])
];

export const PROPERTY_SCHEMA_VERSION = 5;

export function registerPropertySchema(className, schema, { replace = false } = {}) {
  if (typeof className !== 'string' || (className !== '*' && !/^[A-Z][A-Za-z0-9]*$/.test(className))) {
    throw new TypeError('Nome de classe inválido para o Inspector.');
  }
  if (!schema || !Array.isArray(schema.sections)) {
    throw new TypeError('O schema precisa declarar uma lista de seções.');
  }
  const normalized = {
    sections: schema.sections.map(section => {
      if (!section || typeof section.title !== 'string' || !Array.isArray(section.fields)) {
        throw new TypeError('Seção de propriedades inválida.');
      }
      return {
        title: section.title,
        fields: section.fields.map(field => {
          if (!field || typeof field.key !== 'string' || typeof field.label !== 'string') {
            throw new TypeError('Campo de propriedade inválido.');
          }
          if (!['text', 'number', 'slider', 'color', 'select', 'checkbox', 'asset', 'udim2', 'vector2'].includes(field.type)) {
            throw new TypeError('Tipo de campo não suportado: ' + field.type);
          }
          return { ...field, values: field.values?.map(item => ({ ...item })) };
        })
      };
    })
  };
  if (registry.has(className) && !replace) throw new Error('Já existe um schema para ' + className + '.');
  registry.set(className, normalized);
  return normalized;
}

export function getPropertySchema(className) {
  return registry.get(className) || registry.get('*') || { sections: [] };
}

export function listPropertySchemas() {
  return [...registry.entries()].map(([className, schema]) => ({ className, schema }));
}

const frameLayout = [
  udim2('position', 'Position', 'Position'),
  udim2('size', 'Size', 'Size'),
  vector2('anchorPoint', 'AnchorPoint', 'AnchorPoint')
];

registerPropertySchema('*', { sections: [
  { title: 'Identificação', fields: [text('name', 'Nome')] },
  ...layout,
  { title: 'Aparência', fields: appearance }
]});

registerPropertySchema('Frame', { sections: [
  { title: 'Instance', fields: [text('name', 'Name')] },
  { title: 'Layout', fields: frameLayout },
  { title: 'Data', fields: [
    select('automaticSize', 'AutomaticSize', [
      { value: 'None', label: 'None' }, { value: 'X', label: 'X' },
      { value: 'Y', label: 'Y' }, { value: 'XY', label: 'XY' }
    ]),
    select('sizeConstraint', 'SizeConstraint', [
      { value: 'RelativeXY', label: 'RelativeXY' },
      { value: 'RelativeXX', label: 'RelativeXX' },
      { value: 'RelativeYY', label: 'RelativeYY' }
    ]),
    number('layoutOrder', 'LayoutOrder', -1000, 1000),
    number('zIndex', 'ZIndex', 1, 10),
    number('selectionOrder', 'SelectionOrder', 0, 1000)
  ]},
  { title: 'Appearance', fields: [
    color('backgroundColor3', 'BackgroundColor3'),
    slider('backgroundTransparency', 'BackgroundTransparency', 0, 1, 0.01),
    slider('opacity', 'Opacity', 0, 1, 0.01),
    slider('rotation', 'Rotation', -360, 360, 1)
  ]},
  { title: 'UIBackdrop', fields: [
    { ...checkbox('uiBackdrop.enabled', 'Enabled'), backdropSetting: 'enabled' },
    { ...select('uiBackdrop.effect', 'Effect', [
      { value: 'Blur', label: 'Blur' },
      { value: 'LiquidGlass', label: 'LiquidGlass' },
      { value: 'FrostedGlass', label: 'FrostedGlass' },
      { value: 'Acrylic', label: 'Acrylic' }
    ]), backdropSetting: 'effect' },
    { ...slider('uiBackdrop.blur', 'Blur strength', 0, 40, 0.5), backdropSetting: 'effect', effectOnly: ['Blur', 'LiquidGlass', 'FrostedGlass', 'Acrylic'] },
    { ...slider('uiBackdrop.saturation', 'Saturation', 0, 3, 0.01), backdropSetting: 'effect', effectOnly: ['LiquidGlass', 'FrostedGlass', 'Acrylic'] },
    { ...slider('uiBackdrop.brightness', 'Brightness', 0.5, 1.5, 0.01), backdropSetting: 'effect', effectOnly: ['LiquidGlass', 'Acrylic'] },
    { ...slider('uiBackdrop.contrast', 'Contrast', 0.5, 1.5, 0.01), backdropSetting: 'effect', effectOnly: ['LiquidGlass', 'FrostedGlass', 'Acrylic'] },
    { ...color('uiBackdrop.tintColor', 'Tint color'), backdropSetting: 'effect', effectOnly: ['LiquidGlass', 'FrostedGlass', 'Acrylic'] },
    { ...slider('uiBackdrop.tintOpacity', 'Tint opacity', 0, 1, 0.01), backdropSetting: 'effect', effectOnly: ['LiquidGlass', 'FrostedGlass', 'Acrylic'] },
    { ...slider('uiBackdrop.refraction', 'Refraction feel', 0, 1, 0.01), backdropSetting: 'effect', effectOnly: ['LiquidGlass'] },
    { ...slider('uiBackdrop.highlight', 'Edge highlight', 0, 1, 0.01), backdropSetting: 'effect', effectOnly: ['LiquidGlass'] }
  ]},
  { title: 'Behavior', fields: [
    checkbox('visible', 'Visible'),
    checkbox('clipsDescendants', 'ClipsDescendants'),
    checkbox('active', 'Active'),
    checkbox('interactable', 'Interactable'),
    checkbox('selectable', 'Selectable')
  ]}
]});

registerPropertySchema('TextButton', { sections: [
  { title: 'Identificação', fields: [text('name', 'Nome')] },
  ...layout,
  { title: 'Aparência', fields: [color('background', 'Fundo'), ...textAppearance, number('radius', 'Arredondamento', 0, 120), number('opacity', 'Opacidade', 0, 1, 0.05), color('border', 'Borda'), number('borderWidth', 'Espessura da borda', 0, 30), number('rotation', 'Rotação', -360, 360), checkbox('visible', 'Visível')] }
]});

registerPropertySchema('TextLabel', { sections: [
  { title: 'Identificação', fields: [text('name', 'Nome')] },
  ...layout,
  { title: 'Aparência', fields: [color('background', 'Fundo'), ...textAppearance, number('radius', 'Arredondamento', 0, 120), number('opacity', 'Opacidade', 0, 1, 0.05), color('border', 'Borda'), number('borderWidth', 'Espessura da borda', 0, 30), number('rotation', 'Rotação', -360, 360), checkbox('visible', 'Visível')] }
]});

registerPropertySchema('ImageLabel', { sections: [
  { title: 'Identificação', fields: [text('name', 'Nome')] },
  ...layout,
  { title: 'Imagem', fields: [
    { key: 'assetId', label: 'Arquivo da biblioteca', type: 'asset', accept: 'image/*' },
    select('fit', 'Ajuste', [
      { value: 'cover', label: 'Preencher' },
      { value: 'contain', label: 'Conter' },
      { value: 'fill', label: 'Esticar' }
    ])
  ]},
  { title: 'Aparência', fields: [
    color('background', 'Fundo'),
    number('radius', 'Arredondamento', 0, 120),
    number('opacity', 'Opacidade', 0, 1, 0.05),
    color('border', 'Borda'),
    number('borderWidth', 'Espessura da borda', 0, 30),
    number('rotation', 'Rotação', -360, 360),
    checkbox('visible', 'Visível')
  ]}
]});

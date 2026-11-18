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

const sharedLayoutFields = [
  udim2('position', 'Position', 'Position'),
  udim2('size', 'Size', 'Size'),
  vector2('anchorPoint', 'AnchorPoint', 'AnchorPoint')
];
const instanceSection = { title: 'Instance', fields: [text('name', 'Name')] };
const layout = [{ title: 'Layout', fields: sharedLayoutFields }];
const commonAppearance = [
  slider('opacity', 'Opacity', 0, 1, 0.01),
  slider('rotation', 'Rotation', -360, 360, 1),
  checkbox('visible', 'Visible')
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

export const PROPERTY_SCHEMA_VERSION = 10;

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

const frameLayout = sharedLayoutFields;

registerPropertySchema('*', { sections: [
  instanceSection,
  ...layout,
  { title: 'Appearance', fields: [...appearance.filter(field => !['opacity', 'rotation', 'visible'].includes(field.key)), ...commonAppearance] }
]});

registerPropertySchema('Frame', { sections: [
  instanceSection,
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
    slider('radius', 'CornerRadius', 0, 200, 1),
    slider('backgroundTransparency', 'BackgroundTransparency', 0, 1, 0.01),
    ...commonAppearance
  ]},
  { title: 'Behavior', fields: [
    checkbox('clipsDescendants', 'ClipsDescendants'),
    checkbox('active', 'Active'),
    checkbox('interactable', 'Interactable'),
    checkbox('selectable', 'Selectable')
  ]}
]});

registerPropertySchema('TextButton', { sections: [
  instanceSection,
  ...layout,
  { title: 'Text', fields: [...textAppearance] },
  { title: 'Appearance', fields: [color('background', 'BackgroundColor3'), number('radius', 'CornerRadius', 0, 120), color('border', 'BorderColor3'), number('borderWidth', 'BorderSizePixel', 0, 30), ...commonAppearance] }
]});

registerPropertySchema('TextLabel', { sections: [
  instanceSection,
  ...layout,
  { title: 'Text', fields: [...textAppearance] },
  { title: 'Appearance', fields: [color('background', 'BackgroundColor3'), number('radius', 'CornerRadius', 0, 120), color('border', 'BorderColor3'), number('borderWidth', 'BorderSizePixel', 0, 30), ...commonAppearance] }
]});

registerPropertySchema('ImageLabel', { sections: [
  instanceSection,
  ...layout,
  { title: 'Image', fields: [
    { key: 'assetId', label: 'Asset', type: 'asset', accept: 'image/*' },
    select('fit', 'ScaleType', [
      { value: 'cover', label: 'Cover' },
      { value: 'contain', label: 'Contain' },
      { value: 'fill', label: 'Stretch' }
    ])
  ]},
  { title: 'Appearance', fields: [color('background', 'BackgroundColor3'), number('radius', 'CornerRadius', 0, 120), color('border', 'BorderColor3'), number('borderWidth', 'BorderSizePixel', 0, 30), ...commonAppearance] }
]});

registerPropertySchema('UIBackdrop', { sections: [
  instanceSection,
  { title: 'Behavior', fields: [checkbox('enabled', 'Enabled')] },
  { title: 'Effect', fields: [
    { ...select('effect', 'Effect', [
      { value: 'Blur', label: 'Blur' }, { value: 'Prism', label: 'Prism' },
      { value: 'Emboss', label: 'Emboss' }, { value: 'Holographic', label: 'Holographic' }
    ]), enabledOnly: true },
    { ...slider('blur', 'Blur', 0, 40, 0.5), enabledOnly: true, effectOnly: ['Blur'] },
    { ...slider('saturation', 'Saturation', 0, 3, 0.01), enabledOnly: true, effectOnly: ['Blur'] },
    { ...color('tintColor', 'Tint color'), enabledOnly: true, effectOnly: ['Blur'] },
    { ...slider('tintOpacity', 'Tint opacity', 0, 1, 0.01), enabledOnly: true, effectOnly: ['Blur'] },
    { ...slider('prismIntensity', 'Prism intensity', 0, 1, 0.01), enabledOnly: true, effectOnly: ['Prism'] },
    { ...slider('prismAngle', 'Prism angle', 0, 360, 1), enabledOnly: true, effectOnly: ['Prism'] },
    { ...slider('prismScale', 'Prism scale', 0.5, 2, 0.01), enabledOnly: true, effectOnly: ['Prism'] },
    { ...slider('embossDepth', 'Depth', 0, 1, 0.01), enabledOnly: true, effectOnly: ['Emboss'] },
    { ...slider('embossAngle', 'Light angle', 0, 360, 1), enabledOnly: true, effectOnly: ['Emboss'] },
    { ...slider('embossSoftness', 'Softness', 0, 1, 0.01), enabledOnly: true, effectOnly: ['Emboss'] },
    { ...slider('holographicIntensity', 'Holographic intensity', 0, 1, 0.01), enabledOnly: true, effectOnly: ['Holographic'] },
    { ...slider('holographicAngle', 'Holographic angle', 0, 360, 1), enabledOnly: true, effectOnly: ['Holographic'] },
    { ...slider('holographicSpeed', 'Animation speed', 0, 1, 0.01), enabledOnly: true, effectOnly: ['Holographic'] }
  ]}
]});

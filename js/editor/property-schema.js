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

export const PROPERTY_SCHEMA_VERSION = 13;

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
  { title: 'Appearance', fields: [color('background', 'BackgroundColor3'), color('border', 'BorderColor3'), number('borderWidth', 'BorderSizePixel', 0, 30), ...commonAppearance] }
]});

registerPropertySchema('TextLabel', { sections: [
  instanceSection,
  ...layout,
  { title: 'Text', fields: [...textAppearance] },
  { title: 'Appearance', fields: [color('background', 'BackgroundColor3'), color('border', 'BorderColor3'), number('borderWidth', 'BorderSizePixel', 0, 30), ...commonAppearance] }
]});

registerPropertySchema('ImageLabel', { sections: [
  instanceSection,
  ...layout,
  { title: 'Image', fields: [
    { key: 'assetId', label: 'Imagem', type: 'asset', accept: 'image/*' },
    select('fit', 'ScaleType', [
      { value: 'fill', label: 'Stretch' }, { value: 'contain', label: 'Fit' },
      { value: 'cover', label: 'Crop' }, { value: 'tile', label: 'Tile' }
    ]),
    { ...udim2('tileSize', 'TileSize', 'TileSize'), visibleWhen: { key: 'fit', value: 'tile' } },
    slider('imageTransparency', 'ImageTransparency', 0, 1, 0.01)
  ]},
  { title: 'Appearance', fields: [
    color('backgroundColor3', 'BackgroundColor3'),
    slider('backgroundTransparency', 'BackgroundTransparency', 0, 1, 0.01),
    color('border', 'BorderColor3'), number('borderWidth', 'BorderSizePixel', 0, 30), ...commonAppearance
  ]}
]});

registerPropertySchema('UIBackdrop', { sections: [
  instanceSection,
  { title: 'Behavior', fields: [checkbox('enabled', 'Enabled')] },
  { title: 'Blur', fields: [
    { ...slider('blur', 'Blur amount', 0, 64, 0.5), enabledOnly: true },
    { ...slider('saturation', 'Saturation', 0, 2.5, 0.01), enabledOnly: true },
    { ...slider('brightness', 'Brightness', 0.5, 1.5, 0.01), enabledOnly: true },
    { ...slider('contrast', 'Contrast', 0.5, 1.5, 0.01), enabledOnly: true },
    { ...color('tintColor', 'Tint color'), enabledOnly: true },
    { ...slider('tintOpacity', 'Tint strength', 0, 0.5, 0.01), enabledOnly: true }
  ]}
]});

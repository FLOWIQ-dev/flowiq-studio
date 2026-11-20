// One Inspector renders the schema for whichever instance is selected.
// Class schemas are data only: they do not create per-class panels or renderers.
const registry = new Map();

const number = (key, label, min, max, step = 1) => ({ key, label, type: 'number', min, max, step });
const slider = (key, label, min, max, step = 0.01) => ({ key, label, type: 'slider', min, max, step });
const udim2 = (key, label, subgroup) => ({ key, label, type: 'udim2', subgroup, components: 4 });
const vector2 = (key, label, subgroup) => ({ key, label, type: 'vector2', subgroup, components: 2 });
const text = (key, label) => ({ key, label, type: 'text' });
const textarea = (key, label) => ({ key, label, type: 'textarea' });
const color = (key, label) => ({ key, label, type: 'color' });
const select = (key, label, values) => ({ key, label, type: 'select', values });
const checkbox = (key, label) => ({ key, label, type: 'checkbox' });

const layoutFields = [
  udim2('position', 'Position', 'Position'),
  udim2('size', 'Size', 'Size'),
  vector2('anchorPoint', 'AnchorPoint', 'AnchorPoint')
];
const commonAppearanceFields = [
  slider('opacity', 'Opacity', 0, 1, 0.01),
  slider('rotation', 'Rotation', -360, 360, 1),
  checkbox('visible', 'Visible')
];
const guiAppearanceFields = [
  color('backgroundColor3', 'BackgroundColor3'),
  slider('backgroundTransparency', 'BackgroundTransparency', 0, 1, 0.01),
  color('borderColor3', 'BorderColor3'),
  number('borderSizePixel', 'BorderSizePixel', 0, 30),
  ...commonAppearanceFields
];
const textFields = [
  textarea('text', 'Text'),
  color('textColor3', 'TextColor3'),
  slider('textTransparency', 'TextTransparency', 0, 1, 0.01),
  select('fontFace', 'Fonte', [
    { value: 'Arial', label: 'Arial' }, { value: 'Inter', label: 'Inter' },
    { value: 'Roboto', label: 'Roboto' }, { value: 'Georgia', label: 'Georgia' },
    { value: 'Monospace', label: 'Monoespaçada' }
  ]),
  select('fontWeight', 'Espessura', [
    { value: '400', label: 'Regular' }, { value: '500', label: 'Média' },
    { value: '600', label: 'Seminegrito' }, { value: '700', label: 'Negrito' }
  ]),
  number('textSize', 'TextSize', 1, 100),
  checkbox('textScaled', 'TextScaled'),
  checkbox('textWrapped', 'TextWrapped'),
  select('textXAlignment', 'TextXAlignment', [
    { value: 'Left', label: 'Left' }, { value: 'Center', label: 'Center' }, { value: 'Right', label: 'Right' }
  ]),
  select('textYAlignment', 'TextYAlignment', [
    { value: 'Top', label: 'Top' }, { value: 'Center', label: 'Center' }, { value: 'Bottom', label: 'Bottom' }
  ]),
  checkbox('richText', 'RichText'),
  slider('lineHeight', 'Altura da linha', 1, 2, 0.05)
];
const imageFields = [
  { key: 'assetId', label: 'Image', type: 'asset', accept: 'image/*' },
  color('imageColor3', 'ImageColor3'),
  slider('imageTransparency', 'ImageTransparency', 0, 1, 0.01),
  select('fit', 'ScaleType', [
    { value: 'fill', label: 'Stretch' }, { value: 'contain', label: 'Fit' },
    { value: 'cover', label: 'Crop' }, { value: 'tile', label: 'Tile' }
  ]),
  { ...udim2('tileSize', 'TileSize', 'TileSize'), visibleWhen: { key: 'fit', value: 'tile' } }
];
const instanceFields = [text('name', 'Name'), number('zIndex', 'ZIndex', -2147483648, 2147483647)];

export const PROPERTY_SCHEMA_VERSION = 22;

export function registerPropertySchema(className, schema, { replace = false } = {}) {
  if (typeof className !== 'string' || (className !== '*' && !/^[A-Z][A-Za-z0-9]*$/.test(className))) {
    throw new TypeError('Nome de classe inválido para o Inspector.');
  }
  if (!schema || !Array.isArray(schema.sections)) throw new TypeError('O schema precisa declarar uma lista de seções.');
  const normalized = {
    sections: schema.sections.map(section => {
      if (!section || typeof section.title !== 'string' || !Array.isArray(section.fields)) throw new TypeError('Seção de propriedades inválida.');
      return {
        title: section.title,
        fields: section.fields.map(field => {
          if (!field || typeof field.key !== 'string' || typeof field.label !== 'string') throw new TypeError('Campo de propriedade inválido.');
          if (!['text', 'textarea', 'number', 'slider', 'color', 'select', 'checkbox', 'asset', 'udim2', 'vector2'].includes(field.type)) {
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

registerPropertySchema('*', { sections: [
  { title: 'Data', fields: [text('name', 'Name')] },
  { title: 'Layout', fields: layoutFields },
  { title: 'Appearance', fields: [
    color('background', 'Fundo'), color('border', 'Borda'), number('borderWidth', 'Espessura da borda', 0, 30),
    ...commonAppearanceFields
  ]}
]});

registerPropertySchema('Frame', { sections: [
  { title: 'Appearance', fields: [
    color('backgroundColor3', 'BackgroundColor3'),
    slider('backgroundTransparency', 'BackgroundTransparency', 0, 1, 0.01),
    ...commonAppearanceFields
  ]},
  { title: 'Data', fields: [
    text('name', 'Name'),
    select('automaticSize', 'AutomaticSize', [
      { value: 'None', label: 'None' }, { value: 'X', label: 'X' },
      { value: 'Y', label: 'Y' }, { value: 'XY', label: 'XY' }
    ]),
    select('sizeConstraint', 'SizeConstraint', [
      { value: 'RelativeXY', label: 'RelativeXY' }, { value: 'RelativeXX', label: 'RelativeXX' },
      { value: 'RelativeYY', label: 'RelativeYY' }
    ]),
    number('layoutOrder', 'LayoutOrder', -1000, 1000),
    number('zIndex', 'ZIndex', -2147483648, 2147483647),
    number('selectionOrder', 'SelectionOrder', 0, 1000)
  ]},
  { title: 'Behavior', fields: [
    checkbox('clipsDescendants', 'ClipsDescendants'), checkbox('active', 'Active'),
    checkbox('interactable', 'Interactable'), checkbox('selectable', 'Selectable')
  ]},
  { title: 'Layout', fields: layoutFields }
]});

const registerGuiClass = (className, kind, isButton = false) => {
  const sections = [
    { title: 'Appearance', fields: guiAppearanceFields },
    { title: kind, fields: kind === 'Text' ? textFields : [
      ...imageFields,
      ...(isButton ? [
        { key: 'hoverAssetId', label: 'HoverImage', type: 'asset', accept: 'image/*' },
        { key: 'pressedAssetId', label: 'PressedImage', type: 'asset', accept: 'image/*' }
      ] : [])
    ]}
  ];
  if (isButton) sections.push({ title: 'Behavior', fields: [
    checkbox('autoButtonColor', 'AutoButtonColor'), checkbox('interactable', 'Interactable')
  ]});
  sections.push({ title: 'Data', fields: instanceFields }, { title: 'Layout', fields: layoutFields });
  registerPropertySchema(className, { sections });
};

registerGuiClass('TextButton', 'Text', true);
registerGuiClass('TextLabel', 'Text');
registerGuiClass('ImageButton', 'Image', true);
registerGuiClass('ImageLabel', 'Image');

registerPropertySchema('Script', { sections: [
  { title: 'Data', fields: [text('name', 'Name')] }
]});

registerPropertySchema('ScrollingFrame', { sections: [
  { title: 'Appearance', fields: [color('backgroundColor3', 'BackgroundColor3'), slider('backgroundTransparency', 'BackgroundTransparency', 0, 1, 0.01), color('borderColor3', 'BorderColor3'), number('borderSizePixel', 'BorderSizePixel', 0, 30), ...commonAppearanceFields] },
  { title: 'Data', fields: [text('name', 'Name'), number('zIndex', 'ZIndex', -2147483648, 2147483647)] },
  { title: 'Scrolling', fields: [
    checkbox('scrollingEnabled', 'ScrollingEnabled'),
    select('scrollingDirection', 'ScrollingDirection', [{ value: 'Y', label: 'Y' }, { value: 'X', label: 'X' }, { value: 'XY', label: 'XY' }]),
    select('automaticCanvasSize', 'AutomaticCanvasSize', [{ value: 'Y', label: 'Y' }, { value: 'X', label: 'X' }, { value: 'XY', label: 'XY' }, { value: 'None', label: 'None' }]),
    number('canvasWidth', 'CanvasSize X', 0, 10000),
    number('canvasHeight', 'CanvasSize Y', 0, 10000),
    number('scrollBarThickness', 'ScrollBarThickness', 0, 24),
    checkbox('elastic', 'Elastic')
  ]},
  { title: 'Layout', fields: layoutFields }
]});

registerPropertySchema('UIBackdrop', { sections: [
  { title: 'Data', fields: [text('name', 'Name')] },
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

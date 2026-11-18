// Property schema registry for the Inspector.
// Keep property definitions separate from rendering so classes can add or override
// categories without coupling the data model to DOM controls.
const registry = new Map();

const number = (key, label, min, max, step = 1) => ({ key, label, type: 'number', min, max, step });
const slider = (key, label, min, max, step = 0.01) => ({ key, label, type: 'slider', min, max, step });
const text = (key, label) => ({ key, label, type: 'text' });
const color = (key, label) => ({ key, label, type: 'color' });
const select = (key, label, values) => ({ key, label, type: 'select', values });
const checkbox = (key, label) => ({ key, label, type: 'checkbox' });

const layout = [
  { title: 'Position · UDim2', fields: [
    number('position.x.scale', 'X · Scale', -10, 10, 0.01),
    number('position.x.offset', 'X · Offset', -4000, 4000),
    number('position.y.scale', 'Y · Scale', -10, 10, 0.01),
    number('position.y.offset', 'Y · Offset', -4000, 4000)
  ]},
  { title: 'Size · UDim2', fields: [
    number('size.x.scale', 'Largura · Scale', -10, 10, 0.01),
    number('size.x.offset', 'Largura · Offset', 1, 4000),
    number('size.y.scale', 'Altura · Scale', -10, 10, 0.01),
    number('size.y.offset', 'Altura · Offset', 1, 4000)
  ]},
  { title: 'AnchorPoint', fields: [
    number('anchorPoint.x', 'X', 0, 1, 0.01),
    number('anchorPoint.y', 'Y', 0, 1, 0.01)
  ]}
];

const appearance = [
  color('background', 'Fundo'),
  color('border', 'Borda'),
  number('borderWidth', 'Espessura da borda', 0, 30),
  number('radius', 'Arredondamento', 0, 120),
  number('opacity', 'Opacidade', 0, 1, 0.05),
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

export const PROPERTY_SCHEMA_VERSION = 2;

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
          if (!['text', 'number', 'slider', 'color', 'select', 'checkbox', 'asset'].includes(field.type)) {
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
  { title: 'Identificação', fields: [text('name', 'Nome')] },
  ...layout,
  { title: 'Aparência', fields: appearance }
]});

registerPropertySchema('Frame', { sections: [
  { title: 'Instance', fields: [text('name', 'Name')] },
  { title: 'Data', fields: [
    ...layout,
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
    color('borderColor3', 'BorderColor3'),
    slider('borderSizePixel', 'BorderSizePixel', 0, 20, 1),
    select('borderMode', 'BorderMode', [
      { value: 'Outline', label: 'Outline' },
      { value: 'Middle', label: 'Middle' },
      { value: 'Inset', label: 'Inset' }
    ]),
    slider('rotation', 'Rotation', -360, 360, 1)
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

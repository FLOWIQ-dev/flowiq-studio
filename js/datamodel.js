export class Instance {
    constructor(className, name = null) {
        this.id = 'inst_' + Math.random().toString(36).substr(2, 9);
        this.className = className;
        this.name = name || className;
        this.parent = null;
        this.children = [];
        this.properties = {
            positionX: 20,
            positionY: 20,
            width: 200,
            height: 120,
            backgroundColor: className === 'Frame' ? '#1e293b' : '#3b82f6',
            textColor: '#ffffff',
            text: className === 'TextButton' ? 'Botão Interativo' : ''
        };
    }

    setParent(newParent) {
        if (this.parent) {
            this.parent.removeChild(this);
        }
        if (newParent) {
            newParent.children.push(this);
            this.parent = newParent;
        }
    }

    removeChild(child) {
        const index = this.children.indexOf(child);
        if (index !== -1) {
            this.children.splice(index, 1);
            child.parent = null;
        }
    }

    destroy() {
        this.children.forEach(c => c.destroy());
        if (this.parent) {
            this.parent.removeChild(this);
        }
    }

    toJSON() {
        return {
            id: this.id,
            className: this.className,
            name: this.name,
            properties: { ...this.properties },
            children: this.children.map(c => c.toJSON())
        };
    }

    static fromJSON(data, parent = null) {
        const inst = new Instance(data.className, data.name);
        inst.id = data.id;
        inst.properties = { ...data.properties };
        if (parent) inst.setParent(parent);
        if (data.children) {
            data.children.forEach(childData => Instance.fromJSON(childData, inst));
        }
        return inst;
    }
}

export class DataModel {
    constructor() {
        this.root = new Instance('DataModel', 'Workspace');
    }

    loadFromJSON(arrayData) {
        this.root.children = [];
        arrayData.forEach(data => Instance.fromJSON(data, this.root));
    }
}

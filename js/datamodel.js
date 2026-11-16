export class Instance {
    constructor(className, name = null) {
        this.id = 'inst_' + Math.random().toString(36).substr(2, 9);
        this.className = className; // 'ScreenRoot', 'Frame', 'TextButton', 'Folder', etc.
        this.name = name || className;
        this.parent = null;
        this.children = [];
        this.properties = {
            backgroundColor: className === 'Frame' ? '#3b82f6' : (className === 'TextButton' ? '#10b981' : 'transparent'),
            width: className === 'Folder' ? '100%' : '80%',
            height: className === 'Folder' ? '30px' : '45px',
            top: '30px',
            left: '10%',
            text: className === 'TextButton' ? 'Novo Botão' : ''
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

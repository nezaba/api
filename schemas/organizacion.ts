import * as mongoose from 'mongoose';
import * as ubicacionSchema from './ubicacion';
import * as edificioSchema from './edificio';
mongoose.set('debug', true);

var organizacionSchema = new mongoose.Schema({
    codigo: {
        sisa: {
            type: String,
            required: true
        },
        cuie: String,
        remediar: String
    },
    nombre: String,
    tipoEstablecimiento: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'tipoEstablecimiento'
    },
    telecom: [{
        tipo: {
            type: String,
            enum: ["Teléfono Fijo", "Teléfono Celular", "email"]
        },
        valor: String,
        ranking: Number, // Specify preferred order of use (1 = highest) // Podemos usar el rank para guardar un historico de puntos de contacto (le restamos valor si no es actual???)
        ultimaActualizacion: Date,
        activo: Boolean
    }],
    direccion: [{
        valor: String,
        codigoPostal: String,
        ubicacion: ubicacionSchema,
        ranking: Number,
        geoReferencia: {
            type: [Number], // [<longitude>, <latitude>]
            index: '2d' // create the geospatial index
        },
        ultimaActualizacion: Date,
        activo: Boolean
    }],

    //Contact for the organization for a certain purpose.
    contacto: [{
        proposito: String,
        nombre: String,
        apellido: String,
        tipo: {
            type: String,
            enum: ["", "Teléfono Fijo", "Teléfono Celular", "email"]
        },
        valor: String,
        activo: Boolean
    }],
    edificio: [edificioSchema],
    nivelComplejidad: Number,
    activo: Boolean,
    fechaAlta: Date,
    fechaBaja: Date
});

var organizacion = mongoose.model('organizacion', organizacionSchema, 'organizacion');
export = organizacion;
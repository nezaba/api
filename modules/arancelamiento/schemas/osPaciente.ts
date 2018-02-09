import * as mongoose from 'mongoose';

let osPacienteSchema = new mongoose.Schema({
    id: mongoose.Schema.Types.ObjectId,
    tipoDoc: String,
    documento: Number,
    codigoPuco: Number
});

export let osPaciente = mongoose.model('os_paciente', osPacienteSchema, 'os_paciente');


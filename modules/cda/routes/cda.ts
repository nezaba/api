import * as express from 'express';
import { Organizacion } from '../../../core/tm/schemas/organizacion';
import { model as Cie10 } from '../../../core/term/schemas/cie10';
import { makeFs } from '../schemas/CDAFiles';
import * as cdaCtr from '../controller/CDAPatient';
import { Types } from 'mongoose';
import * as moment from 'moment';
import { Auth } from '../../../auth/auth.class';
import { EventCore } from '@andes/event-bus';
import { AndesDrive } from '@andes/drive';
import { PacienteCtr } from '../../../core-v2/mpi/paciente/paciente.routes';
import { findById } from '../../../core-v2/mpi/paciente/paciente.controller';
import { vacunas } from '../../vacunas/schemas/vacunas';
import { checkFichaAbierta } from '../../forms/forms-epidemiologia/controller/forms-epidemiologia.controller';

const ObjectId = Types.ObjectId;

const path = require('path');
const router = express.Router();
const to_json = require('xmljson').to_json;

router.post('/create', cdaCtr.validateMiddleware, async (req: any, res, next) => {
    if (!Auth.check(req, 'cda:post')) {
        return next(403);
    }
    try {
        return await createCDA(req, res, next);
    } catch (e) {
        return next(e);
    }
});

router.post('/create/sisa-covid', cdaCtr.validateMiddleware, async (req, res, next) => {
    if (!Auth.check(req, 'cda:post')) {
        return next(403);
    }
    const { documento, sexo } = req.body.paciente;
    const cda = req.body;
    const pacientes = await PacienteCtr.search({ documento, sexo, activo: true }); // Identificamos el registro de paciente

    if (pacientes.length !== 1) {
        return next('No es posible identificar al paciente.');
    }

    const paciente = pacientes[0];
    const fichaAbierta = await checkFichaAbierta(paciente._id, cda.fecha); // Verificamos que no existan registros previos para el caso

    if (fichaAbierta) {
        return next('El caso ya fue registrado.');
    }
    req.body.paciente = paciente;
    return await createCDA(req, res, next);
});

/**
 * Emite un evento para generar los CDA de un paciente
 */

router.post('/paciente', async (req: any, res, next) => {
    if (!Auth.check(req, 'cda:post')) {
        return next(403);
    }
    // elimina vacunas y cdas previos antes de generar nuevos
    await vacunas.deleteMany({ documento: req.body.paciente.documento });
    await cdaCtr.deleteCda(null, req.body.paciente.id);

    EventCore.emitAsync('monitoreo:cda:create', req.body);
    res.json({ status: 'ok' });
});

/**
 * Injecta un CDA ya armado al repositorio
 */

router.post('/', async (req: any, res, next) => {
    const orgId = req.user.organizacion.id ? req.user.organizacion.id : req.user.organizacion;
    const cda64 = req.body.cda;
    const adjunto64 = req.body.adjunto;

    const cdaStream: any = cdaCtr.base64toStream(cda64);
    const cdaXml: String = await cdaCtr.streamToString(cdaStream.stream);

    if (cdaXml.length > 0) {
        cdaCtr.validateSchemaCDA(cdaXml).then(async (dom) => {

            const cdaData: any = cdaCtr.checkAndExtract(dom);

            if (cdaData) {
                const uniqueId = new ObjectId();

                if (cdaData.organizacion.id !== orgId) {
                    return next({ error: 'wrong_organization' });
                }

                cdaData.fecha = moment(cdaData.fecha, 'YYYYMMDDhhmmss').toDate();
                cdaData.paciente.fechaNacimiento = moment(cdaData.paciente.fechaNacimiento, 'YYYYMMDDhhmmss');
                cdaData.paciente.sexo = cdaData.paciente.sexo === 'M' ? 'masculino' : 'femenino';

                const yaExiste = await cdaCtr.CDAExists(cdaData.id, cdaData.fecha, orgId);
                if (yaExiste) {
                    return next({ error: 'prestacion_existente' });
                }

                const organizacion = await Organizacion.findById(orgId);
                const dataProfesional = req.body.profesional;

                const prestacion = await cdaCtr.matchCodeByLoinc(cdaData.loinc);
                if (!prestacion) {
                    // Es obligatorio que posea prestación
                    return next({ error: 'prestacion_invalida' });
                }

                const pacientec = await cdaCtr.findOrCreate(req, cdaData.paciente, orgId);

                let fileData, adjuntos;
                if (cdaData.adjunto && adjunto64) {
                    const fileObj: any = cdaCtr.base64toStream(adjunto64);
                    fileObj.metadata = {
                        cdaId: uniqueId,
                        paciente: ObjectId(pacientec.id)
                    };
                    fileObj.filename = cdaData.adjunto;
                    fileData = await cdaCtr.storeFile(fileObj);
                    adjuntos = [{ path: fileData.data, id: fileData.id }];
                }
                const metadata = {
                    paciente: pacientec._id,
                    prestacion,
                    organizacion,
                    profesional: dataProfesional,
                    fecha: cdaData.fecha,
                    adjuntos,
                    extras: {
                        id: cdaData.id,
                        organizacion: ObjectId(orgId)
                    }
                };
                const obj = await cdaCtr.storeCDA(uniqueId, cdaXml, metadata);

                res.json({ cda: uniqueId, paciente: pacientec._id });

            } else {
                return next({ error: 'cda_format_error' });
            }

        }).catch(next);
    } else {
        return next({ error: 'xml_file_missing' });
    }

});

/**
 * Devuelve el archivo de estilo para renderizar HTML desde el browser.
 */

router.get('/style/cda.xsl', (req, res, next) => {
    const name = path.join(__dirname, '../controller/cda.xsl');
    res.sendFile(name);
});


/**
 * Devuelve los archivos almacenados por los CDAs
 * Cuando se renderiza un CDA en el browser busca los archivos adjuntos en esta ruta
 * [DEPRECATED]
 */

router.get('/files/:name', async (req: any, res, next) => {
    if (req.user.type === 'user-token' && !Auth.check(req, 'cda:get')) {
        return next(403);
    }

    const name = req.params.name;
    const CDAFiles = makeFs();

    CDAFiles.findOne({ filename: name }).then(async file => {
        if (req.user.type === 'paciente-token' && String(file.metadata.paciente) !== String(req.user.pacientes[0].id)) {
            return next(403);
        }

        const stream1 = await CDAFiles.readFile({ _id: file._id });
        res.contentType(file.contentType);
        stream1.pipe(res);
    }).catch(next);
});

/**
 * Listado de los CDAs de un paciente dado su documento y su sexo.
 */

router.get('/paciente/', async (req: any, res, next) => {
    if (!Auth.check(req, 'cda:list')) {
        return next(403);
    }

    try {
        const lista = [];
        let list = [];
        const documento = req.query.documento;
        const sexo = req.query.sexo;
        const resultado = await PacienteCtr.search({ documento, sexo }, {}, req);

        for (let i = 0; i < resultado.length; i++) {
            const pac: any = resultado[i];
            const pacienteID = pac._id;
            list = await cdaCtr.searchByPatient(pacienteID, null, { skip: 0, limit: 100 });
            lista.push(list);
        }
        res.json(lista);

    } catch {
        return res.send({ error: 'paciente_error' });
    }
});

/**
 * Devuelve el XML de un CDA según un ID
 */
router.get('/:id', async (req: any, res, next) => {
    // if (!Auth.check(req, 'cda:get')) {
    //     return next(403);
    // }

    const _base64 = Types.ObjectId(req.params.id);
    const CDAFiles = makeFs();
    const contexto = await CDAFiles.findOne({ _id: _base64 });
    CDAFiles.readFile({ _id: _base64 }, (err, buffer) => {
        res.contentType(contexto.contentType);
        res.end(buffer);
    });
});


/**
 * Devuelve el CDA parseado a json según un ID
 */

router.get('/tojson/:id', async (req: any, res, next) => {
    if (!Auth.check(req, 'cda:get')) {
        return next(403);
    }
    const _base64 = req.params.id;
    let contexto = await cdaCtr.loadCDA(_base64);
    let setText = false;
    // Limpiamos xml previo al parsing
    contexto = contexto.toString().replace(new RegExp('<br>', 'g'), ' ');
    contexto = contexto.toString().replace(new RegExp('[\$]', 'g'), '');
    contexto = contexto.toString().replace(new RegExp('&#xD', 'g'), '');

    /**
     * ATENCION: FIX para poder visualizar los informes de evolución que traen caracteres raros.
     * Obtenemos el texto dentro de los tags <text> del xml, la extraemos tal cual está y la agregamos luego de la ejecución del parser
     * para conservala tal cual la escribieron.
     * PD: Deberemos mejorar esto a futuro!
     */

    let resultado = contexto.toString().match('(<text>)[^~]*(<\/text>)')[0];
    if (!resultado.includes('Sin datos')) {
        resultado = resultado.replace('<text>', '');
        resultado = resultado.replace('</text>', '');
        setText = true;
    }
    contexto = contexto.toString().replace(new RegExp('(<text>)[^~]*(<\/text>)'), '');
    to_json(contexto, (error, data) => {
        if (error) {
            return next(error);
        } else {
            if (setText) {
                // Volvemos a agregar el texto de la evolución
                if (typeof data.ClinicalDocument.component.structuredBody.component.section === 'object') {
                    data.ClinicalDocument.component.structuredBody.component.section.text = resultado;
                } else {
                    data.ClinicalDocument.component.structuredBody.component.section = { text: resultado };
                }
            }
            res.json(data);
        }
    });
});

/**
 * Listado de los CDAs de un paciente
 * API demostrativa, falta analizar como se va a buscar en el repositorio
 */
router.get('/paciente/:id', async (req: any, res, next) => {

    if (!Auth.check(req, 'cda:list') || (req.user.type !== 'paciente-token'
        && req.user.type !== 'user-token' && req.user.type !== 'user-token-2')) {
        return next(403);
    }

    if (ObjectId.isValid(req.params.id)) {
        const pacienteID = req.params.id;
        const prestacion = req.query.prestacion;
        const paciente: any = await PacienteCtr.findById(pacienteID, {});

        if (paciente) {
            const list = await cdaCtr.searchByPatient(paciente.vinculos, prestacion, { skip: 0, limit: 100 });
            return res.json(list);
        }
    }
    return next({ message: 'no existe el paciente' });

});

/**
 * Devuelve los archivos almacenados por los CDAs
 * Cuando se renderiza un CDA en el browser busca los archivos adjuntos en esta ruta
 */

router.get('/:id/:name', async (req: any, res, next) => {
    try {

        if (req.user.type === 'user-token' && !Auth.check(req, 'cda:get')) {
            return next(403);
        }

        const cda = await cdaCtr.getCDAById(req.params.id);
        const idPaciente = cda.metadata.paciente;

        if (req.user.type === 'paciente-token') {
            const paciente: any = await findById(idPaciente);
            const index = req.user.pacientes.findIndex(item => String(item.id) === String(idPaciente));
            let esFamiliar;
            if (index < 0) {
                const resultado = await findById((req as any).user.pacientes[0].id);
                esFamiliar = resultado.relaciones.find(rel => {
                    return rel.referencia.toString() === paciente.id.toString();
                });
            }
            if (!(index >= 0 || esFamiliar)) {
                return next(403);
            }
        }

        const realName = req.params.name.split('.')[0];
        const cdaFile = await cdaCtr.getCdaAdjunto(cda, realName);
        const contentType = cdaFile.file.contentType || cdaFile.file.mimetype;
        const str = cdaFile.stream;
        res.contentType(contentType);
        str.pipe(res);
    } catch (ex) {
        return next(500);
    }
});

async function createCDA(req, res, next) {
    const idPrestacion = req.body.id;
    const fecha = moment(req.body.fecha).toDate();

    let orgId = req.user.organizacion.id ? req.user.organizacion.id : req.user.organizacion;
    if (Auth.check(req, 'cda:organizacion') && req.body.organizacion) {
        orgId = req.body.organizacion;
    }
    const yaExiste = await cdaCtr.CDAExists(idPrestacion, fecha, orgId);
    if (yaExiste) {
        return res.json({ cda: yaExiste._id, paciente: yaExiste.paciente?._id });
    }

    const dataPaciente = req.body.paciente;
    const dataProfesional = req.body.profesional;

    // Devuelve un Loinc asociado al código SNOMED
    const prestacion = await cdaCtr.matchCode(req.body.tipoPrestacion);
    if (!prestacion) {
        // Es obligatorio que posea prestación
        return next({ error: `prestacion_invalida ${req.body.tipoPrestacion}` });
    }
    const cie10Code = req.body.cie10;
    const file: string = req.body.file;
    const texto = req.body.texto;
    // Terminar de decidir esto
    const organizacion = await Organizacion.findById(orgId, { _id: 1, nombre: 1 });
    let cie10 = null;
    if (cie10Code) {
        cie10 = await Cie10.findOne({
            $or: [
                { codigo: cie10Code },
                { codigo: cie10Code + '.9' },
                { codigo: cie10Code + '.8' }]
        });
        if (!cie10) {
            return next({ error: `cie10_invalid  ${cie10Code}` });
        }
    }
    let confidencialidad = 'N';
    if (req.body.confidencialidad === 'R') {
        confidencialidad = req.body.confidencialidad;
    }

    const paciente = await cdaCtr.findOrCreate(req, dataPaciente, organizacion._id);
    if (!paciente) {
        return next({ error: 'paciente_inexistente' });
    }
    const uniqueId = String(new ObjectId());

    let fileData, adjuntos;
    if (file) {
        if (file.startsWith('id:')) {
            const id = file.substring(3);
            const adjunto = await AndesDrive.find(id);
            if (adjunto) {
                fileData = {
                    id,
                    is64: false,
                    mime: adjunto.mimetype,
                    data: `${id}.${adjunto.extension}`
                };
                adjuntos = [{ path: fileData.data, id: ObjectId(fileData.id), adapter: 'drive' }];
            } else {
                return next({ error: 'file_not_exists' });
            }
        } else {
            const fileObj: any = cdaCtr.base64toStream(file);
            fileObj.metadata = {
                cdaId: ObjectId(uniqueId),
                paciente: ObjectId(paciente.id)
            };
            fileData = await cdaCtr.storeFile(fileObj);
            adjuntos = [{ path: fileData.data, id: fileData.id }];
        }
    }
    const cda = cdaCtr.generateCDA(uniqueId, confidencialidad, paciente, fecha, dataProfesional, organizacion, prestacion, cie10, texto, fileData);

    const metadata = {
        paciente: paciente._id,
        prestacion,
        profesional: dataProfesional,
        organizacion,
        adjuntos,
        fecha,
        extras: {
            id: idPrestacion,
            organizacion: organizacion._id
        }
    };
    await cdaCtr.storeCDA(uniqueId, cda, metadata);
    EventCore.emitAsync('huds:cda:create', { cda: uniqueId, paciente: paciente._id });
    res.json({ cda: uniqueId, paciente: paciente._id });

}

export = router;

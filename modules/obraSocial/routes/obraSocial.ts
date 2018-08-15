import * as express from 'express';
import { puco } from '../schemas/puco';
import { obraSocial } from '../schemas/obraSocial';

let router = express.Router();

/**
 * Obtiene los datos de la obra social asociada a un paciente
 *
 * @param {any} dni
 * @returns
 */

router.get('/puco/', async function (req, res, next) {

    if (req.query.dni) {
        let padron;
        let rta;

        if (req.query.periodo) {
            padron = req.query.periodo;
        } else {
            padron = await obtenerVersiones();   // trae las distintas versiones de los padrones
            padron = padron[0].version; // asigna el ultimo padron actualizado
        }
        // realiza la busqueda por dni y el padron seteado anteriormente
        rta = await puco.find({ dni: Number.parseInt(req.query.dni), version: padron }).exec();

        if (rta.length > 0) {
            let resultOS = [];
            let unaOS;
            // genera un array con todas las obras sociales para una version de padron dada
            for (let i = 0; i < rta.length; i++) {
                unaOS = await obraSocial.find({ codigoPuco: rta[i].codigoOS }).exec();
                resultOS[i] = { tipoDocumento: rta[i].tipoDoc, dni: rta[i].dni, transmite: rta[i].transmite, nombre: rta[i].nombre, codigoFinanciador: rta[i].codigoOS, financiador: unaOS[0].nombre, version: rta[i].version };
            }
            res.json(resultOS);
        } else {
            res.json([]);
        }
    } else {
        res.status(400).json({ msg: 'Parámetros incorrectos' });
    }
});

router.get('/puco/padrones/', async function (req, res, next) {
    let resp = await obtenerVersiones();
    res.json(resp);
});


// obtiene las versiones de todos los padrones cargados
async function obtenerVersiones() {
    let versiones = await puco.distinct('version').exec();  // esta consulta obtiene un arreglo de strings
    for (let i = 0; i < versiones.length; i++) {
        versiones[i] = { 'version': versiones[i] };
    }
    versiones.sort((a, b) => compare(a.version, b.version));
    return versiones;
}

// Compara fechas. Junto con el sort ordena los elementos de mayor a menor.
function compare(a, b) {
    if (new Date(a) > new Date(b)) {
        return -1;
    }
    if (new Date(a) < new Date(b)) {
        return 1;
    }
    return 0;
}

module.exports = router;

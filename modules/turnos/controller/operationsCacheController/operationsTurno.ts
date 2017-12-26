// Imports
import * as mongoose from 'mongoose';
import {
    agendasCache
} from '../../../legacy/schemas/agendasCache';
import * as sql from 'mssql';
import * as moment from 'moment';
import * as pacientes from './../../../../core/mpi/controller/paciente';
import * as constantes from '../../../legacy/schemas/constantes';
import * as logger from './../../../../utils/loggerAgendaSipsCache';
import * as agendaSchema from '../../schemas/agenda';
import * as turnoCtrl from './../turnoCacheController';

import * as pacienteOps from './operationsPaciente';


export function processTurnos(agendas: any, idAgendaCreada: any, idEfector: any) {
    let turnos;
    return new Promise(async function (resolve, reject) {
        try {
            for (let x = 0; x < agendas.bloques.length; x++) {
                turnos = agendas.bloques[x].turnos;

                for (let i = 0; i < turnos.length; i++) {

                    if (turnos[i].estado === 'asignado') {
                        let idTurno = await existeTurnoSips(turnos[i]);

                        if (!idTurno) {
                            await grabaTurnoSips(turnos[i], idAgendaCreada, idEfector);
                            // resolve();
                        } else {
                            // resolve();
                        }
                        // resolve();
                    } else {
                        // resolve();
                    }
                }
            }
            resolve();
        } catch (ex) {
            reject(ex);
        }
    });
}

export function existeTurnoSips(turno: any) {
    return new Promise(function (resolve, reject) {
        let transaction;
        return new sql.Request(transaction)
            .input('idTurnoMongo', sql.VarChar(50), turno._id)
            .query('SELECT idTurno FROM dbo.CON_Turno WHERE objectId = @idTurnoMongo GROUP BY idTurno')
            .then(result => {
                if (result.length > 0) {
                    resolve(result[0].idTurno);
                } else {
                    resolve(false);
                }
            }).catch(err => {
                reject(err);
            });
    });
}

export function checkEstadoTurno(agenda: any, idAgendaSips) {
    let turnos;
    return new Promise(async function (resolve, reject) {
        try {
            for (let x = 0; x < agenda.bloques.length; x++) {
                turnos = agenda.bloques[x].turnos;

                for (let i = 0; i < turnos.length; i++) {
                    if ((turnos[i].estado !== 'disponible') || (turnos[i].updatedAt)) {
                        await actualizarEstadoTurnoSips(idAgendaSips, turnos[i]);
                        // resolve();
                    } else {
                        // resolve();
                    }
                }
            }
            resolve();

        } catch (ex) {
            reject(ex);
        }
    });
}

/* TODO: ver si hay mas estados de turnos entre CITAS y SIPS*/
function getEstadoTurnosCitasSips(estadoTurnoCitas, updated) {
    return new Promise(async function (resolve, reject) {
        try {
            let estado: any;

            if (estadoTurnoCitas === 'asignado') {
                estado = constantes.EstadoTurnosSips.activo;
            } else if ((estadoTurnoCitas === 'disponible') && (updated)) {
                estado = constantes.EstadoTurnosSips.liberado;
            } else if (estadoTurnoCitas === 'suspendido') {
                estado = constantes.EstadoTurnosSips.suspendido;
            }

            resolve(estado);
        } catch (ex) {
            reject(ex);
        }
    });
}

async function actualizarEstadoTurnoSips(idAgendaSips, turno) {
    return new Promise(async function (resolve, reject) {
        try {
            let estadoTurnoSips: any = await getEstadoTurnoSips(turno._id);
            let estadoTurnoMongo = await getEstadoTurnosCitasSips(turno.estado, turno.updatedAt);

            if (estadoTurnoSips.idTurnoEstado !== estadoTurnoMongo) {
                let objectIdTurno;

                if (turno._id) {
                    objectIdTurno = ' and objectId = \'' + turno._id + '\'';
                    resolve();
                } else {
                    resolve();
                }

                /*TODO: hacer enum con los estados */
                var horaInicio = moment(turno.horaInicio).utcOffset('-03:00').format('HH:mm');

                if ((estadoTurnoMongo === constantes.EstadoTurnosSips.suspendido || turno.estado === 'turnoDoble') && !await existeTurnoBloqueoSips(idAgendaSips, horaInicio)) {
                    await grabarTurnoBloqueo(idAgendaSips, turno);
                    resolve();
                } else {
                    resolve();
                }

                let query = 'UPDATE dbo.CON_Turno SET idTurnoEstado = ' + estadoTurnoMongo + ' WHERE idAgenda = ' + idAgendaSips + objectIdTurno;
                await executeQuery(query);
                resolve();
            } else {
                resolve();
            }
        } catch (ex) {
            reject(ex);
        }
    });
}

async function existeTurnoBloqueoSips(idAgendaSips, horaInicio) {
    return new Promise(async function (resolve, reject) {
        let transaction;
        let query = 'SELECT COUNT(b.idTurnoBloqueo) as count FROM CON_TurnoBloqueo b ' +
            'JOIN CON_TURNO t on t.idAgenda = b.idAgenda ' +
            'WHERE b.idAgenda = ' + idAgendaSips +
            ' AND b.horaTurno = \'' + horaInicio + '\'';

        try {
            let result = await new sql.Request(transaction).query(query);
            resolve(result[0].count > 0);
        } catch (err) {
            reject(err);
        }
    });
}



async function grabarTurnoBloqueo(idAgendaSips, turno) {
    return new Promise(async function (resolve, reject) {
        try {
            const motivoBloqueo = getMotivoTurnoBloqueoSips(turno);
            var fechaBloqueo = moment(turno.horaInicio).format('YYYYMMDD');
            var horaBloqueo = moment(turno.horaInicio).utcOffset('-03:00').format('HH:mm');

            let queryTurnoBloqueo = 'INSERT dbo.CON_TurnoBloqueo (idAgenda ' +
                ', fechaTurno ' +
                ', horaTurno ' +
                ', idUsuarioBloqueo ' +
                ', fechaBloqueo ' +
                ', idMotivoBloqueo) ';
            queryTurnoBloqueo += 'VALUES (' +
                idAgendaSips + ', ' +
                '\'' + fechaBloqueo + '\', ' +
                '\'' + horaBloqueo + '\', ' +
                constantes.idUsuarioSips + ', ' +
                '\'' + moment(turno.updatedAt).format('YYYYMMDD') + '\', ' +
                motivoBloqueo + ')';

            await executeQuery(queryTurnoBloqueo);
            resolve();
        } catch (ex) {
            reject(ex);
        }
    });
}

function getMotivoTurnoBloqueoSips(turno) {
    return new Promise(async function (resolve, reject) {
        try {
            let motivoBloqueo;

            if (turno.estado === 'suspendido') {
                motivoBloqueo = getMotivoTurnoSuspendido(turno.motivoSuspension);
            } else if (turno.estado === 'turnoDoble') {
                motivoBloqueo = constantes.MotivoTurnoBloqueo.turnoDoble;
            }

            resolve(motivoBloqueo);
        } catch (ex) {
            reject(ex);
        }
    });
}


function getMotivoTurnoSuspendido(motivoSuspension) {
    return new Promise(async function (resolve, reject) {
        try {
            let devuelveMotivoSuspension;

            switch (motivoSuspension) {
                case 'profesional':
                    devuelveMotivoSuspension = constantes.MotivoTurnoBloqueo.retiroDelProfesional;
                    break;
                case 'edilicia':
                    devuelveMotivoSuspension = constantes.MotivoTurnoBloqueo.otros;
                    break;
                case 'organizacion':
                    devuelveMotivoSuspension = constantes.MotivoTurnoBloqueo.reserva;
                    break;
            }

            resolve(devuelveMotivoSuspension);
        } catch (ex) {
            reject(ex);
        }
    });
}


/* Devuelve el estado del turno en Con_Turno de SIPS */
function getEstadoTurnoSips(objectId: any) {
    return new Promise((resolve: any, reject: any) => {
        let transaction;
        (async function () {
            try {
                let query = 'SELECT idAgenda, idTurno, idTurnoEstado FROM dbo.CON_Turno WHERE objectId = @objectId';
                let result = await new sql.Request(transaction)
                    .input('objectId', sql.VarChar(50), objectId)
                    .query(query);

                if (typeof result[0] !== 'undefined') {
                    resolve(result[0]);
                } else {
                    let idTurnoEstado = 0;
                    resolve(idTurnoEstado);
                }
            } catch (err) {
                reject(err);
            }
        })();
    });
}

export function checkAsistenciaTurno(agenda: any) {
    let turnos;
    return new Promise(async function (resolve, reject) {
        try {
            for (let x = 0; x < agenda.bloques.length; x++) {
                turnos = agenda.bloques[x].turnos;

                for (let i = 0; i < turnos.length; i++) {
                    if (turnos[i].asistencia === 'asistio') {

                        let idTurno: any = await getEstadoTurnoSips(turnos[i]._id);
                        let fechaAsistencia = moment(turnos[i].updatedAt).format('YYYYMMDD');
                        let query = 'INSERT INTO dbo.CON_TurnoAsistencia ( idTurno , idUsuario , fechaAsistencia ) VALUES  ( ' +
                            idTurno.idTurno + ' , ' + constantes.idUsuarioSips + ' , \'' + fechaAsistencia + '\' )';

                        await executeQuery(query);

                        // resolve();
                    } else {
                        // resolve();
                    }
                }
            }
            resolve();
        } catch (ex) {
            reject(ex);
        }
    });
}

export async function grabaTurnoSips(turno, idAgendaSips, idEfector) {
    return new Promise(async function (resolve, reject) {
        try {
            // TODO: El paciente pudiera no estar validado, en ese caso no se encontrara en la
            // colección de paciente de MPI, en ese caso buscar en la coleccion de pacientes de Andes
            let pacienteEncontrado = await pacientes.buscarPaciente(turno.paciente.id);
            let paciente = pacienteEncontrado.paciente;
            // if(!pacienteEncontrado) {
            //  pacienteEncontrado = buscar en andes.......
            // }

            let idObraSocial = await getIdObraSocialSips(paciente.documento);
            let pacienteId = await pacienteOps.getPacienteMPI(paciente, idEfector);

            let fechaTurno = moment(turno.horaInicio).format('YYYYMMDD');
            let horaTurno = moment(turno.horaInicio).utcOffset('-03:00').format('HH:mm');

            let query = 'INSERT INTO dbo.CON_Turno ( idAgenda , idTurnoEstado , idUsuario ,  idPaciente ,  fecha , hora , sobreturno , idTipoTurno , idObraSocial , idTurnoAcompaniante, objectId ) VALUES  ( ' +
                idAgendaSips + ' , 1 , ' + constantes.idUsuarioSips + ' ,' + pacienteId + ', \'' + fechaTurno + '\' ,\'' + horaTurno + '\' , 0 , 0 ,' + idObraSocial + ' , 0, \'' + turno._id + '\')';

            let turnoGrabado = await executeQuery(query);
            resolve(turnoGrabado);
        } catch (ex) {
            reject(ex);
        }
    });
}


/**
 * @description obtiene ID de O.Social buscando coincidencias 'DNI/Cod O.S' en la tabla de PUCO
 * pudiendo devolver 0..n códigos de obra social. Según los códigos obtenidos, se retornará un único id
 * según siguiente criterio:
 *     - Si se obtiene +2 resultados, se optará por el de máxima prioridad, siendo que:
 *     - ISSN: Mínima prioridad
 *     - PAMI: Prioridad media
 *     - Cualquier otro financiador: Prioridad máxima
 *     - Si obtiene 1 resultado, es el elegido
 *     - Si se obtiene 0 resultados, se retorna el id de PLAN SUMAR por defecto, cuyo valor está en constante.
 * @param {any} documentoPaciente
 * @returns
 */
async function getIdObraSocialSips(documentoPaciente) {
    return new Promise(async function (resolve, reject) {
        let transaction;
        const idSumar = 499;
        let query = 'SELECT TOP(1) sips_os.idObraSocial as idOS ' +
            'FROM [Padron].[dbo].[Pd_PUCO] puco ' +
            'JOIN [SIPS].[dbo].[Sys_ObraSocial] sips_os ON puco.CodigoOS = sips_os.cod_PUCO ' +
            'WHERE puco.DNI =  ' + documentoPaciente +
            'ORDER BY  ( ' +
            'SELECT p =  ' +
            'CASE prio.prioridad  ' +
            'WHEN NULL THEN 1 ' +
            'ELSE prio.prioridad ' +
            'END ' +
            'FROM [SIPS].[dbo].[Sys_ObraSocial_Prioridad] as prio ' +
            'WHERE prio.idObraSocial = sips_os.idObraSocial ' +
            ') ASC';

        try {
            let result = await new sql.Request(transaction).query(query);
            resolve(result.length > 0 ? result[0].idOS : idSumar);
        } catch (err) {
            reject(err);
        }
    });
}


function executeQuery(query: any) {
    query += ' select SCOPE_IDENTITY() as id';
    return new Promise((resolve: any, reject: any) => {
        return new sql.Request()
            .query(query)
            .then(result => {
                resolve(result[0].id);
            }).catch(err => {
                reject(err);
            });
    });
}

import * as express from 'express';
import { Auth } from './../auth.class';
import { AuthUsers } from '../schemas/authUsers';
import { Organizacion } from './../../core/tm/schemas/organizacion';
import * as mongoose from 'mongoose';

import { checkPassword } from '../ldap.controller';
import { findUser, updateUser, checkMobile } from '../auth.controller';

const sha1Hash = require('sha1');
const shiroTrie = require('shiro-trie');
const router = express.Router();


/**
 * Obtiene el user de la session
 * @get /api/auth/sesion
 */

router.get('/sesion', Auth.authenticate(), (req, res) => {
    res.json((req as any).user);
});

/**
 * Listado de organizaciones a las que el usuario tiene permiso
 * @get /api/auth/organizaciones
 */
router.get('/organizaciones', Auth.authenticate(), async (req: any, res, next) => {
    let username;
    if (req.query.user) {
        username = req.query.user;
    } else {
        username = (req as any).user.usuario.username;
    }

    const user: any = await AuthUsers.findOne({ usuario: username });

    const organizaciones = user.organizaciones.filter(x => x.activo === true).map((item) => {
        if (req.query.admin) {
            const shiro = shiroTrie.new();
            const permisos = [...user.permisosGlobales, ...item.permisos];
            shiro.add(permisos);

            if (shiro.check('usuarios:set')) {
                return mongoose.Types.ObjectId(item._id);
            } else {
                return null;
            }
        } else {
            return mongoose.Types.ObjectId(item._id);
        }
    }).filter(item => item !== null);
    const orgs = await Organizacion.find({ _id: { $in: organizaciones } }, { nombre: 1 });
    return res.json(orgs);
});

/**
 * Refresca el token y los permisos dado una organizacion}
 * @param {ObjectId} organizacion ID de la organizacion
 * @post /api/auth/organizaciones
 */

router.post('/organizaciones', Auth.authenticate(), (req, res, next) => {
    const username = (req as any).user.usuario.username;
    const orgId = mongoose.Types.ObjectId(req.body.organizacion);
    Promise.all([
        AuthUsers.findOne({
            usuario: username,
            'organizaciones._id': orgId
        }),
        Organizacion.findOne({ _id: orgId }, { nombre: 1 })
    ]).then((data: any[]) => {
        if (data[0] && data[1]) {
            const user = data[0];
            const org = data[1];
            const oldToken: string = String(req.headers.authorization).substring(4);
            const nuevosPermisos = user.organizaciones.find(item => String(item._id) === String(org._id));
            const refreshToken = Auth.refreshToken(oldToken, user, [...user.permisosGlobales, ...nuevosPermisos.permisos], org);
            res.send({
                token: refreshToken
            });
        } else {
            next('Organización inválida');
        }
    });
});

/**
 * Refresca el token y los permisos dado una organizacion}
 * @param {string} username nombre de usuario (DNI)
 * @param {string} password Password de la cuenta
 * @post /api/auth/login
 */

router.post('/login', async (req, res, next) => {
    // Función interna que genera token
    const login = async (user, prof) => {
        await updateUser(user.usuario, user.nombre, user.apellido, user.password);

        if (req.body.mobile) {
            if (prof && prof._id) {
                checkMobile(prof._id).then((account: any) => {
                    return res.json({
                        token: Auth.generateUserToken(user, null, [], prof, account._id),
                        user: account
                    });
                }).catch((e) => {
                    return next(403);
                });
            } else {
                return next(403);
            }
        } else {
            res.json({
                token: Auth.generateUserToken(user, null, [], prof)
            });
        }
    };

    if (!req.body.usuario || !req.body.password) {
        return next(403);
    }

    try {
        const userResponse = await findUser(req.body.usuario);
        if (userResponse) {
            const { user, profesional }: any = userResponse;
            switch (user.authMethod || 'ldap') {
                case 'ldap':
                    const ldapUser = await checkPassword(user, req.body.password);
                    if (ldapUser) {
                        user.nombre = ldapUser.nombre;
                        user.apellido = ldapUser.apellido;
                        user.password = sha1Hash(req.body.password);
                        return login(user, profesional);
                    } else {
                        return next(403);
                    }
                case 'password':
                    const passwordSha1 = sha1Hash(req.body.password);
                    if (passwordSha1 === user.password) {
                        return login(user, profesional);
                    }
                    break;
            }
        }
        return next(403);
    } catch (error) {
        return next(403);
    }
});

/**
 * Genera FileToken para poder acceder a archivos embebidos
 */

router.post('/file-token', Auth.authenticate(), (req, res, next) => {
    return res.json({ token: Auth.generateFileToken() });
});

export = router;

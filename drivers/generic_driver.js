/*
Copyright 2021 -2023, Robin de Gruijter (gruijter@hotmail.com)

This file is part of com.gruijter.callmebot.

com.gruijter.callmebot is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

com.gruijter.callmebot is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with com.gruijter.callmebot. If not, see <http://www.gnu.org/licenses/>.
*/

'use strict';

const Homey = require('homey');
const https = require('https');
const qs = require('querystring');

class Driver extends Homey.Driver {

	async onDriverInit() {
		this.log('onDriverInit');
	}

	onPair(session) {
		try {
			this.log('Pairing of new message receiver started');

			let number = '';
			let apikey = '';

			session.setHandler('login', async (data) => {
				number = data.username.replace(/ /gi, '');
				apikey = data.password;

				const args = {
					device: {
						settings: {
							number,
							apikey,
						},
						driver: {
							ds: {
								driverId: this.ds.driverId,
							},
						},
					},
					msg: 'Homey can send messages to this device!',
				};
				const credentialsAreValid = await this.send(args);
				return credentialsAreValid;
			});

			session.setHandler('list_devices', () => {
				const device = {
					name: `${this.ds.driverId}_${number}`,
					data: {
						id: `${this.ds.driverId}_${number}`,
					},
					settings: {
						number,
						apikey,
					},
					capabilities: ['last_sent'],
				};
				return [device];
			});

		} catch (error) {
			this.error(error);
		}

	}

	// https://api.callmebot.com/signal/send.php?phone=[phone_number]&apikey=[your_apikey]&image=[url_image]
	async sendImage(args) {
		try {
			const { driverId } = args.device.driver.ds;
			const query = {	};
			// if (driverId === 'telegram') query.user = args.device.settings.number;
			if (driverId === 'signal' ) {
				query.phone = args.device.settings.number;
			}
			if (driverId === 'signal') {
				query.apikey = args.device.settings.apikey;
			}
			query.image = args.imgUrl;
			const headers = {
				// 'Cache-Control': 'no-cache',
			};
			const options = {
				hostname: 'api.callmebot.com',
				path: `${this.ds.imagePath}?${qs.stringify(query).replace(/phone=%2B/gi, 'phone=+')}`,
				headers,
				method: 'GET',
			};
			const result = await this._makeHttpsRequest(options, '');
			if (result.statusCode !== 200) {
				throw Error(`${result.statusCode}: ${result.body.substr(0, 250)}`);
			}
			const strippedString = result.body.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
			const signalOK = result.body.includes('Image sent to');
			const fbOK = result.body.includes('Message sent');

			if (!(signalOK || fbOK)) throw Error(strippedString);
			return Promise.resolve(strippedString);
		} catch (error) {
			return Promise.reject(error);
		}
	}

	// http://api.callmebot.com/start.php?user=@username&text=This+is+a+robot+calling+you+to+inform+you+about+something+urgent+that+is+happening&lang=en-GB-Standard-B&rpt=2
	async sendVoice(args) {
		try {
			const query = {
				user: args.device.settings.number,
				text: args.msg,
				lang: `${args.language}-Standard-${args.voice}`,
				rpt: 2, // number to repeat msg
			};
			const headers = {
				'Cache-Control': 'no-cache',
			};
			const options = {
				hostname: 'api.callmebot.com',
				path: `${this.ds.voicePath}?${qs.stringify(query).replace(/%2B/gi, '+')}`,
				headers,
				method: 'GET',
			};
			const result = await this._makeHttpsRequest(options, '');
			if (result.statusCode !== 200) {
				throw Error(`${result.statusCode}: ${result.body.substr(0, 250)}`);
			}

			let strippedString = result.body.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
			const telegramOK = result.body.includes('Call ended after');
			if (telegramOK) strippedString = 'Call successfully ended';
			if (!(telegramOK)) throw Error(strippedString);
			return Promise.resolve(strippedString);
		} catch (error) {
			return Promise.reject(error);
		}
	}

	// https://api.callmebot.com/signal/send.php?phone=[phone_number]&apikey=[your_apikey]&text=[message]
	async send(args) {
		try {
			const { driverId } = args.device.driver.ds;
			const query = {
				text: args.msg,
			};
			if (driverId === 'signal') {
				query.phone = args.device.settings.number;
			}
			if (driverId === 'signal') {
				query.apikey = args.device.settings.apikey;
			}

			const headers = {
				'Cache-Control': 'no-cache',
			};
			const options = {
				hostname: 'api.callmebot.com',
				path: `${this.ds.path}?${qs.stringify(query).replace(/%2B/gi, '+')}`,
				headers,
				method: 'GET',
			};
			const result = await this._makeHttpsRequest(options, '');
			if (result.statusCode !== 200) {
				throw Error(`${result.statusCode}: ${result.body.substr(0, 250)}`);
			}

			let strippedString = result.body.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
			const signalOK = result.body.includes('Message sent to');
			const whatsappOK = result.body.includes('Message queued');
			const fbOK = result.body.includes('Message sent');
			const telegramOK = result.body.includes('Status: Successful');
			if (telegramOK) strippedString = 'Status: Successful';
			if (!(signalOK || whatsappOK || fbOK || telegramOK)) throw Error(strippedString);
			return Promise.resolve(strippedString);
		} catch (error) {
			return Promise.reject(error);
		}
	}

	_makeHttpsRequest(options, postData, timeout) {
		return new Promise((resolve, reject) => {
			const opts = options;
			opts.timeout = timeout || 30000;
			const req = https.request(opts, (res) => {
				let resBody = '';
				res.on('data', (chunk) => {
					resBody += chunk;
				});
				res.once('end', () => {
					if (!res.complete) {
						this.error('The connection was terminated while the message was still being sent');
						return reject(Error('The connection was terminated while the message was still being sent'));
					}
					res.body = resBody;
					return resolve(res); // resolve the request
				});
			});
			req.on('error', (e) => {
				req.destroy();
				this.error(e);
				return reject(e);
			});
			req.on('timeout', () => {
				req.destroy();
			});
			// req.write(postData);
			req.end(postData);
		});
	}
}

module.exports = Driver;

declare module 'web-push' {
	export function generateVAPIDKeys(): { publicKey: string; privateKey: string };
	export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
	export function sendNotification(subscription: any, payload?: any, options?: any): Promise<any>;

	const webpush: {
		generateVAPIDKeys: typeof generateVAPIDKeys;
		setVapidDetails: typeof setVapidDetails;
		sendNotification: typeof sendNotification;
	};

	export default webpush;
}

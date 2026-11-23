import { generateKeyPair,exportJWK,SignJWT } from 'jose';
export async function customAuthFixture() {
 const base='https://custom-cake-fixture.example.test';
 const {privateKey,publicKey}=await generateKeyPair('EdDSA');
 const jwk={...await exportJWK(publicKey),kid:'cake-fixture-key',alg:'EdDSA'};
 const token=subject=>new SignJWT({}).setProtectedHeader({alg:'EdDSA',kid:jwk.kid}).setSubject(subject).setIssuer(base).setAudience(base).setIssuedAt().setExpirationTime('10m').sign(privateKey);
 return {base,jwk,token};
}

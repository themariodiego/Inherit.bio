import "server-only";
/** TEST intake only. Native scope and all producer dispositions remain closed
 * independently. This flag supplies no identity, ownership or review proof. */
export function testAppealIntakeOpen(){
 return process.env.INHERIT_TEST_JURISDICTION==="1"&&process.env.INHERIT_TEST_REQUESTER_STATEMENTS==="1";
}

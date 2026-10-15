import {Button,Text} from "@react-email/components";
import {EmailLayout,brand} from "./base";

export interface AppealEvidenceProps {continueUrl:string}
/** The same generic message for every public intake. It reveals no account,
 * subject match, decision, statement, reviewer or genetic information. */
export function AppealEvidenceEmail({continueUrl}:AppealEvidenceProps){
 return <EmailLayout heading="Continue your request">
  <Text style={{fontSize:"16px",lineHeight:"1.6",color:brand.inkMuted}}>
   Use this private link to continue the request sent to Inherit. Opening the
   link does not confirm an account or access to any record.
  </Text>
  <Button href={continueUrl} style={{backgroundColor:brand.forest,color:brand.paper,
   padding:"14px 22px",borderRadius:"8px",textDecoration:"none",fontSize:"16px"}}>
   Continue your request
  </Button>
  <Text style={{fontSize:"16px",lineHeight:"1.6",color:brand.inkMuted}}>
   Keep this link private. If you did not make this request, you can ignore this message.
  </Text>
 </EmailLayout>;
}

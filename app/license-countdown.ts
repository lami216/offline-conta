export function formatLicenseDuration(totalSeconds:number){
  let remaining=Math.max(0,Math.floor(totalSeconds));
  const units=[{seconds:604800,label:"أسبوع"},{seconds:86400,label:"يوم"},{seconds:3600,label:"ساعة"},{seconds:60,label:"دقيقة"},{seconds:1,label:"ثانية"}];
  const parts:string[]=[];
  for(const unit of units){const value=Math.floor(remaining/unit.seconds);if(value>0)parts.push(`${value} ${unit.label}`);remaining%=unit.seconds}
  return parts.length?parts.join(" • "):"0 ثانية";
}

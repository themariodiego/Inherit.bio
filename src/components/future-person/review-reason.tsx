"use client";

import {useId} from "react";

export function ReviewReason({value,disabled,onChange}:{value:string;disabled:boolean;onChange:(value:string)=>void}) {
  const id=useId();
  return <div>
    <label className="block" htmlFor={id}>Reason</label>
    <textarea id={id} value={value} minLength={20} maxLength={2000} rows={5} disabled={disabled}
      onChange={event=>onChange(event.target.value)} required/>
  </div>;
}

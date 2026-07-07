import * as React from "react";

type ButtonBaseProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export const ButtonBase = React.forwardRef<HTMLButtonElement, ButtonBaseProps>(
  ({ type = "button", ...props }, ref) => (
    <button ref={ref} type={type} {...props} />
  ),
);

ButtonBase.displayName = "ButtonBase";

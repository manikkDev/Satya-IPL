import hmac
import os

from fastapi import Header, HTTPException


def internal(x_internal_token: str = Header(default="")):
    secret = os.environ.get("NODE_INTERNAL_TOKEN", "")
    if not secret or secret in {"change-me", "replace-me"} or not hmac.compare_digest(x_internal_token, secret):
        raise HTTPException(401, "Invalid service authentication")

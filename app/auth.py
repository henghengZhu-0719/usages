import secrets

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from app.config import AUTH_PASS, AUTH_USER

_security = HTTPBasic(auto_error=False)


def require_auth(credentials: HTTPBasicCredentials = Depends(_security)) -> bool:
    """AUTH_USER / AUTH_PASS 留空时不做鉴权，配了才启用 HTTP Basic Auth。"""
    if not AUTH_USER and not AUTH_PASS:
        return True

    valid = credentials is not None and secrets.compare_digest(
        credentials.username, AUTH_USER
    ) and secrets.compare_digest(credentials.password, AUTH_PASS)

    if not valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
            headers={"WWW-Authenticate": "Basic"},
        )
    return True

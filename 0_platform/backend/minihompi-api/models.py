from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(100), unique=True, index=True, nullable=False)
    password = Column(String(255), nullable=False)
    username = Column(String(50), unique=True, index=True, nullable=False)
    nickname = Column(String(50), nullable=False)
    profile_image = Column(String(255), nullable=True)
    bio = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    minihompi = relationship("MiniHompi", back_populates="owner", uselist=False)
    diaries = relationship("Diary", back_populates="author")
    photos = relationship("Photo", back_populates="owner")


class MiniHompi(Base):
    __tablename__ = "minihompis"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    title = Column(String(100), default="Welcome to my mini hompi!")
    bgm_url = Column(String(255), nullable=True)
    skin = Column(String(50), default="default")
    today_count = Column(Integer, default=0)
    total_count = Column(Integer, default=0)

    owner = relationship("User", back_populates="minihompi")
    guestbooks = relationship("GuestBook", back_populates="minihompi")


class Diary(Base):
    __tablename__ = "diaries"

    id = Column(Integer, primary_key=True, index=True)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String(200), nullable=False)
    content = Column(Text, nullable=False)
    mood = Column(String(50), nullable=True)
    is_public = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    author = relationship("User", back_populates="diaries")


class Photo(Base):
    __tablename__ = "photos"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    image_url = Column(String(255), nullable=False)
    caption = Column(Text, nullable=True)
    album_name = Column(String(100), default="default")
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User", back_populates="photos")


class GuestBook(Base):
    __tablename__ = "guestbooks"

    id = Column(Integer, primary_key=True, index=True)
    minihompi_id = Column(Integer, ForeignKey("minihompis.id"), nullable=False)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    is_secret = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    minihompi = relationship("MiniHompi", back_populates="guestbooks")
    author = relationship("User")


class Friend(Base):
    __tablename__ = "friends"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    friend_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    relation_name = Column(String(50), default="ilchon")
    status = Column(String(20), default="pending")
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", foreign_keys=[user_id])
    friend = relationship("User", foreign_keys=[friend_id])

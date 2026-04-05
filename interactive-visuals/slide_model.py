from enum import Enum
from typing import Union, Optional, List
from pydantic import BaseModel, Field


class Size(BaseModel):
    """The size of the element in pixels"""
    reasoning: str = Field(description="This will not be rendered. Use this space to explicitly calculate the size of the element, using the cluster centering logic in <element_placement>.")
    width: float = Field(description="The width of the element in pixels")
    height: float = Field(description="The height of the element in pixels")

class Position(BaseModel):
    """The position of the element in pixels. This position is the top left corner of the element."""
    reasoning: str = Field(description="This will not be rendered. Use this space to explicitly calculate the position of the element, using the cluster centering logic in <element_placement>.")
    x: float = Field(description="The x-coordinate of the element in pixels")
    y: float = Field(description="The y-coordinate of the element in pixels")

class SlideElementType(str, Enum):
    TEXT = "text"
    CIRCLE = "circle"
    RECT = "rect"
    LINE = "line"
    MATH = "math"

class Rect(BaseModel):
    """A rectangle shape"""
    type: SlideElementType = SlideElementType.RECT
    backgroundColor: Optional[str] = Field(default=None, description="The background color of the rectangle.")
    borderRadius: Optional[float] = Field(default=None, description="The amount of rounding of the corners of the rectangle in pixels.")
    borderWidth: Optional[float] = Field(default=None, description="The width of the border of the rectangle in pixels.")
    borderColor: Optional[str] = Field(default=None, description="The color of the border of the rectangle.")

class Circle(BaseModel):
    """A circle shape"""
    type: SlideElementType = SlideElementType.CIRCLE
    fillColor: Optional[str] = Field(default=None, description="The color of the circle.")
    strokeColor: Optional[str] = Field(default=None, description="The color of the stroke of the circle.")
    strokeWidth: Optional[float] = Field(default=None, description="The width of the stroke of the circle in pixels.")

class ArrowheadStyle(str, Enum):
    ARROW = "arrow"
    TICKMARK = "tickmark"
    NONE = "none"

class Line(BaseModel):
    """A line shape with optional arrowheads"""
    type: SlideElementType = SlideElementType.LINE
    start: Position = Field(description="The start position of the line, relative to the size and position of this element.")
    end: Position = Field(description="The end position of the line, relative to the size and position of this element.")
    stroke: Optional[str] = Field(default=None, description="The color of the stroke of the line.")
    strokeWidth: Optional[float] = Field(default=None, description="The width of the stroke of the line in pixels.")
    controlPoint: Optional[Position] = Field(default=None, description="The control point of the line, relative to the size and position of this element. This is used to curve the line.")
    strokeDasharray: Optional[str] = Field(default=None, description="The dash style of the stroke of the line.")
    startArrowhead: Optional[ArrowheadStyle] = Field(default=None, description="The style of the arrowhead at the start of the line.")
    endArrowhead: Optional[ArrowheadStyle] = Field(default=None, description="The style of the arrowhead at the end of the line.")

class Math(BaseModel):
  type: SlideElementType = SlideElementType.MATH
  latex: str = Field(description="The LaTeX content of the element. Don't include $ signs.")
  color: Optional[str] = Field(default=None, description="The color of the math element.")
  fontSize: Optional[float] = Field(default=None, description="The font size of the math element in pixels.")
  reasoning: str = Field(description="This will not be rendered. Use this space to explicitly calculate the width of the math element.")

class Text(BaseModel):
    """A text element"""
    type: SlideElementType = SlideElementType.TEXT
    text: str = Field(description="The plain text content of the element.")
    fontSize: Optional[float] = Field(default=None, description="The font size of the text in pixels.")
    fontWeight: Optional[float] = Field(default=None, description="The font weight of the text. 100-900.")
    color: Optional[str] = Field(default=None, description="The color of the text.")
    textAlign: Optional[str] = Field(default=None, description="The alignment of the text. left, center, right.")
    textDecoration: Optional[str] = Field(default=None, description="This can only be set to none or underline. No other text decorations are supported.")
    lineHeight: Optional[float] = Field(default=None, description="If text is wrapped, this is the scale of how much space is between lines. For example, if the font size is 24, and the line height is 1.5, then the total height of each line will be 24 * 1.5 = 36 pixels.")
    fontStyle: Optional[str] = Field(default=None, description="The style of the text. Only normal or italic are supported.")
    reasoning: str = Field(description="This will not be rendered. Use this space to explicitly calculate the width of the text element.")

SlideElementContent = Union[
    Text,
    Math,
    Line,
    Rect,
    Circle,
]

class SlideElement(BaseModel):
    id: str = Field(description="The id of the element")
    content: SlideElementContent = Field(description="The content of the element")
    size: Size = Field(description="The size of the element in pixels")
    position: Position = Field(description="The position of the element. This position is the top left corner of the element.")
    zIndex: int = Field(description="If multiple elements overlap, the z-index determines how elements are layered. Higher z-index means the element is in front of other elements.")
    rotation: float = Field(description="The rotation of the element in degrees")
    fragmentIndex: Optional[int] = Field(default=None, description="The index of when the element will be animated on the slide. An index of 0 means the element will be animated first. If you want many elements to animate at the same time, then use the same fragmentIndex.")
    autoSize: Optional[bool] = Field(default=None, description="Whether the element should be automatically resized to fit its content.")
    opacity: Optional[float] = Field(default=None, description="The opacity of the element from 0 (transparent) to 1 (opaque).")

class Slide(BaseModel):
    id: str
    content: str
    elements: List[SlideElement]
